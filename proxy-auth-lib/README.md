# Trusted proxy auth libraries

Vendor-neutral JWT/JWKS middleware for applications that sit behind an identity-aware proxy, ingress, or access gateway.

## Layout

| Path | Target |
|---|---|
| `nodejs/` | Express, Fastify, and Hono adapters |
| `meteor/accounts-proxy-auth/` | `mieweb:accounts-proxy-auth` Atmosphere package (accounts-base login) |
| `python/` | ASGI (FastAPI/Starlette), WSGI (Flask), and Django middleware |
| `rust/` | Axum middleware |
| `go/` | `net/http` middleware (drops into Chi as-is) |
| `testdata/` | Shared JWKS and JWT fixtures used by all language tests |

### Node.js entry points

| Import | Adapter |
|---|---|
| `@mieweb/trusted-proxy-auth/express` | `createTrustedProxyAuth(config)` → `(req, res, next)` |
| `@mieweb/trusted-proxy-auth/fastify` | `fastifyTrustedProxyAuth(config)` → `preHandler` hook |
| `@mieweb/trusted-proxy-auth/hono` | `honoTrustedProxyAuth(config)` → `(c, next)` |

### Meteor

`meteor add mieweb:accounts-proxy-auth` wires the verification into
`accounts-base`: the server validates the assertion on page load and logs the
user in via a one-time login token. See
[meteor/accounts-proxy-auth](meteor/accounts-proxy-auth/README.md).

### Python entry points

| Import | Adapter |
|---|---|
| `trusted_proxy_auth.TrustedProxyAuthMiddleware` | ASGI (FastAPI/Starlette) |
| `trusted_proxy_auth.flask.TrustedProxyAuthMiddleware` | WSGI (`app.wsgi_app = ...`) |
| `trusted_proxy_auth.django.TrustedProxyAuthMiddleware` | Django `MIDDLEWARE` entry |

The verified identity exposes `subject`, `email`, `name`, and the raw `claims`.

## Shared configuration

Every setting is optional. By default the auth domain is derived from the host's
FQDN (`web1.os.example.org` → `auth.os.example.org`), and the issuer and JWKS URL
are derived from that domain. Override any single value with its own variable.

| Variable | Default | Purpose |
|---|---|---|
| `TRUSTED_PROXY_AUTH_DOMAIN` | `auth.<parent-domain-of-hostname>` | Base domain used to derive the issuer and JWKS URL |
| `TRUSTED_PROXY_ASSERTION_HEADER` | `X-Trusted-Proxy-Assertion` | Header containing the signed identity assertion |
| `TRUSTED_PROXY_JWKS_URL` | `https://<domain>/.well-known/jwks.json` | JWKS URL used to resolve signing keys |
| `TRUSTED_PROXY_ISSUER` | `https://<domain>` | Expected JWT issuer |
| `TRUSTED_PROXY_AUDIENCE` | `https://<domain>` | Expected JWT audience |

Set `TRUSTED_PROXY_AUTH_DOMAIN` explicitly in any environment where the host
FQDN does not match the auth domain, and set `TRUSTED_PROXY_AUDIENCE` to a
per-application value if you want tokens scoped to one service.

## Security boundary

Do not trust raw identity headers such as `X-Forwarded-User`, `X-User`, `X-Email`, or `Remote-User` on their own. A backend should trust only a signed assertion that it verifies against a trusted JWKS, issuer, audience, and expiration policy.

## Proxy pattern

The same middleware works when the upstream component is Cloudflare Access, Pomerium, OAuth2 Proxy, Envoy `ext_authz`, Traefik ForwardAuth, NGINX `auth_request`, or a custom gateway. The application trusts the signature, not the proxy brand.
