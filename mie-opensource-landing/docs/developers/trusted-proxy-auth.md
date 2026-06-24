# Trusted proxy auth libraries

`proxy-auth-lib/` contains vendor-neutral middleware examples for applications that sit behind an identity-aware proxy or access gateway.

## Problem boundary

The middleware validates a signed JWT/JWS assertion from a trusted upstream component. It does not implement login flows, browser sessions, or authorization policy.

## Trust model

```mermaid
flowchart TD
    User[User] --> Proxy[Identity-aware proxy or gateway]
    Proxy -->|signed assertion header| App[Application middleware]
    App -->|verified identity| Handler[Application handler]

    classDef trusted fill:#e8f5e9,stroke:#1b5e20
    classDef edge fill:#fff3e0,stroke:#e65100

    class Proxy,App,Handler trusted
    class User edge
```

Never trust raw identity headers such as `X-Forwarded-User`, `X-User`, `X-Email`, or `Remote-User` without cryptographic verification. The examples in this repository require a signed assertion, a JWKS, an expected issuer, an expected audience, and a valid expiration time.

## Shared configuration

Every setting is optional. By default the auth domain is derived from the host's FQDN (`web1.os.example.org` → `auth.os.example.org`); the issuer and JWKS URL come from that domain. Override any single value with its own variable.

| Variable | Default | Purpose |
|---|---|---|
| `TRUSTED_PROXY_AUTH_DOMAIN` | `auth.<parent-domain-of-hostname>` | Base domain used to derive the issuer and JWKS URL |
| `TRUSTED_PROXY_ASSERTION_HEADER` | `X-Trusted-Proxy-Assertion` | Header containing the signed assertion |
| `TRUSTED_PROXY_JWKS_URL` | `https://<domain>/.well-known/jwks.json` | JWKS URL for key discovery |
| `TRUSTED_PROXY_ISSUER` | `https://<domain>` | Expected issuer |
| `TRUSTED_PROXY_AUDIENCE` | `https://<domain>` | Expected audience |

## Implemented MVP targets

| Language | Framework target | Package path |
|---|---|---|
| Node.js | Express-style middleware | `proxy-auth-lib/nodejs/` |
| Python | ASGI middleware for FastAPI / Starlette-style apps | `proxy-auth-lib/python/` |
| Rust | Axum middleware | `proxy-auth-lib/rust/` |
| Go | `net/http` middleware | `proxy-auth-lib/go/` |

## Vendor-neutral examples

Cloudflare Access, Pomerium, OAuth2 Proxy, Envoy `ext_authz`, Traefik ForwardAuth, NGINX `auth_request`, and custom gateways all fit the same pattern when they can forward a signed assertion. The application should trust the signature and claims, not the proxy brand.

## Verified identity examples

### Node.js

```js
app.use(createTrustedProxyAuth(loadConfigFromEnv()));
app.get('/me', (req, res) => res.json(req.trustedProxyIdentity));
```

### Python

```python
app = TrustedProxyAuthMiddleware(app, load_config_from_env())
# request.scope["trusted_proxy_identity"] inside the downstream app
```

### Rust

```rust
let app = Router::new()
    .route("/me", get(handler))
    .layer(middleware::from_fn_with_state(auth.clone(), axum_middleware));
```

### Go

```go
mux.Handle("/me", auth.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
    identity, _ := trustedproxyauth.IdentityFromContext(r.Context())
    json.NewEncoder(w).Encode(identity)
})))
```
