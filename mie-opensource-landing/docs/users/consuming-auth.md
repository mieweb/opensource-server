# Adding Authentication

You can put a sign-in wall in front of any HTTP service so only authenticated users reach it — without writing login code yourself. Requests are authenticated by [oauth2-proxy](../admins/core-concepts/external-domains.md#authentication) before they ever reach your app; your app just reads who the user is.

## Turn on authentication

1. Make sure the external domain your service uses has an **oauth2-proxy URL** configured. This is an admin setup — if it isn't set, ask your environment administrator (see [External Domains — Authentication](../admins/core-concepts/external-domains.md#authentication)).
2. Enable the **Require auth** checkbox on your HTTP service when [creating or editing the container](creating-containers/web-gui.md).

That's it — unauthenticated visitors are now redirected to sign in. The rest of this page is about reading the signed-in user's identity in your app, in three ways:

1. **Server-side apps** — read the identity headers NGINX adds to each proxied request.
2. **Apps that need the raw token / extra claims** — read and (optionally) verify the access token.
3. **Static / "serverless" frontends** — call oauth2-proxy's `/oauth2/userinfo` endpoint from the browser.

## Identity headers (server-side)

Every authenticated request arrives at your backend with a **stable set of headers** describing the signed-in user. The names are always the same, so your app can rely on them:

| Header | Description |
|--------|-------------|
| `X-User` | Stable, unique user id (the identity provider's `sub` claim). Treat it as an opaque key — it isn't guaranteed to be human-readable. |
| `X-Preferred-Username` | Human-friendly username (when the user has one) |
| `X-Email` | User's email |
| `X-Groups` | Comma-separated list of the user's groups |
| `X-Access-Token` | The user's access token, for calling other APIs on their behalf (see below). May be absent depending on how the domain is configured. |

!!! tip "Which header to use for what"
    Use `X-User` as the **stable key** to identify a user in your database or logs — it never changes, even if they rename themselves or change email. To **display** a name, use `X-Preferred-Username` (falling back to `X-Email`); `X-User` may be an opaque id (such as a UUID) and isn't guaranteed to be meaningful to a person.

Reading them is trivial — they are ordinary request headers. Example in Node/Express:

```js
app.get('/', (req, res) => {
  const user = {
    id: req.get('X-User'),
    username: req.get('X-Preferred-Username'),
    email: req.get('X-Email'),
    groups: (req.get('X-Groups') || '').split(',').filter(Boolean),
  };
  res.json({ user });
});
```

!!! warning "Trust boundary"
    These headers are trustworthy because every request reaches your service through the authenticating proxy, which sets them (and overwrites any a client tries to send). For this to hold, don't expose your container on a separate route that bypasses the proxy, and don't forward these headers on to untrusted third parties.

## Reading and verifying the access token

If you need more than the identity headers above — for example to call another API on the user's behalf, or to read custom claims — use the access token from the `X-Access-Token` header. (If that header isn't present, access-token passthrough isn't enabled for your domain; ask your administrator.)

Whether that token is a **JWT** depends on your identity provider:

- **Providers that issue JWT access tokens** (Keycloak, Microsoft Entra ID, Auth0, etc.) — you can decode and verify it.
- **Providers that issue opaque tokens** (e.g. plain Google OAuth) — the token is not a JWT; treat it as a bearer string and validate it by calling the provider's introspection/userinfo endpoint instead.

### Decode (no verification)

A JWT is three base64url segments (`header.payload.signature`). Decoding the payload gives you the claims, but **decoding is not verification** — never make an authorization decision on a decoded-but-unverified token that came from an untrusted source.

```js
function decodeJwtPayload(token) {
  const payload = token.split('.')[1];
  const json = Buffer.from(payload, 'base64url').toString('utf8');
  return JSON.parse(json);
}
```

### Verify (recommended)

Verify the signature against your IdP's public keys (JWKS) and check the standard claims (`iss`, `aud`, `exp`). Use a maintained library rather than hand-rolling this.

```js
import { createRemoteJWKSet, jwtVerify } from 'jose';

// Your IdP's JWKS endpoint, e.g. from its OIDC discovery document
// (<issuer>/.well-known/openid-configuration -> "jwks_uri").
const JWKS = createRemoteJWKSet(new URL(process.env.OIDC_JWKS_URI));

async function verifyAccessToken(token) {
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: process.env.OIDC_ISSUER,      // expected "iss"
    audience: process.env.OIDC_AUDIENCE,  // expected "aud" (your client/app id)
  });
  return payload; // verified claims
}
```

!!! tip
    The values you need (`OIDC_ISSUER`, `OIDC_JWKS_URI`, `OIDC_AUDIENCE`) come from the same identity provider oauth2-proxy is configured against. Ask the administrator who set up the **oauth2-proxy URL** for the domain, or read them from the provider's discovery document at `<issuer>/.well-known/openid-configuration`.

!!! warning
    `X-Access-Token` is a credential. Do not log it, return it to the browser, or send it anywhere other than the API it is intended for.

## Static / "serverless" frontends: `/oauth2/userinfo`

A single-page app, static site, or any frontend with **no backend of its own** cannot read the identity headers (those are added between NGINX and a backend, not visible to the browser). Instead, oauth2-proxy exposes a JSON endpoint on the app's own origin:

```
GET https://app.example.com/oauth2/userinfo
```

Because `/oauth2/*` is served on your app's own hostname, the browser sends the session cookie automatically — just include credentials:

```js
const res = await fetch('/oauth2/userinfo', { credentials: 'include' });
if (res.status === 401) {
  // Not signed in — send the user through sign-in, then back here.
  window.location.href =
    '/oauth2/sign_in?rd=' + encodeURIComponent(window.location.href);
} else {
  const user = await res.json();
  // { user, email, groups, preferredUsername, additionalClaims }
  console.log(user.preferredUsername, user.email, user.groups);
}
```

The response is JSON with this shape:

```json
{
  "user": "a1b2c3d4",
  "email": "jane@example.com",
  "groups": ["developers", "admins"],
  "preferredUsername": "jane",
  "additionalClaims": {}
}
```

| Field | Description |
|-------|-------------|
| `user` | Stable, unique user id (the provider's `sub` claim) — treat as an opaque key; not guaranteed to be human-readable |
| `email` | User's email |
| `groups` | Array of group names (omitted if none) |
| `preferredUsername` | Human-friendly username (omitted if the user doesn't have one) |
| `additionalClaims` | Any extra identity claims configured for your domain (omitted if none) |

!!! warning "`/oauth2/userinfo` is for display, not authorization"
    This endpoint reflects the browser's own session, so it is fine for personalizing the UI (showing a name, hiding admin links). It is **not** an authorization mechanism — a static frontend cannot keep secrets, and a determined user controls their own browser. Enforce access control on the **server** side: keep sensitive data behind a Require-auth backend (which reads the trusted identity headers) or behind an API that verifies the token.

### Helpful oauth2-proxy endpoints from the browser

| Endpoint | Purpose |
|----------|---------|
| `/oauth2/userinfo` | JSON identity of the current session (`401` if not signed in) |
| `/oauth2/sign_in?rd=<return-url>` | Start sign-in, then return to `<return-url>` |
| `/oauth2/sign_out?rd=<return-url>` | Clear the oauth2-proxy session cookie |

!!! note
    The `/oauth2` prefix is the default. If the administrator changed oauth2-proxy's `--proxy-prefix`, these paths change accordingly.
