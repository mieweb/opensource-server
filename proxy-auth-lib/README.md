# Trusted proxy auth libraries

Vendor-neutral JWT/JWKS middleware for applications that sit behind an identity-aware proxy, ingress, or access gateway.

## Layout

| Path | Target |
|---|---|
| `nodejs/` | Express-style middleware (`req`, `res`, `next`) |
| `python/` | ASGI middleware for FastAPI/Starlette-style apps |
| `rust/` | Axum middleware |
| `go/` | `net/http` middleware |
| `testdata/` | Shared JWKS and JWT fixtures used by all language tests |

## Shared configuration

| Variable | Purpose |
|---|---|
| `TRUSTED_PROXY_ASSERTION_HEADER` | Header containing the signed identity assertion |
| `TRUSTED_PROXY_JWKS_URL` | JWKS URL used to resolve signing keys |
| `TRUSTED_PROXY_ISSUER` | Expected JWT issuer |
| `TRUSTED_PROXY_AUDIENCE` | Expected JWT audience |

## Security boundary

Do not trust raw identity headers such as `X-Forwarded-User`, `X-User`, `X-Email`, or `Remote-User` on their own. A backend should trust only a signed assertion that it verifies against a trusted JWKS, issuer, audience, and expiration policy.

## Proxy pattern

The same middleware works when the upstream component is Cloudflare Access, Pomerium, OAuth2 Proxy, Envoy `ext_authz`, Traefik ForwardAuth, NGINX `auth_request`, or a custom gateway. The application trusts the signature, not the proxy brand.
