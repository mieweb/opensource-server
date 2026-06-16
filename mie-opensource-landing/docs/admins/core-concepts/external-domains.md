
# External Domains

External domains expose container HTTP services to the internet. Domains are global resources available to all sites.

## Prerequisites

- A registered domain with Cloudflare DNS (only supported provider)
- Cloudflare account email and a User API Token for DNS management

## Domain Properties

| Field | Description |
|-------|-------------|
| **Domain Name** | Top-level domain (e.g., `example.com`) |
| **Default Site** | The site whose DNS is assumed pre-configured (e.g., wildcard A record). Selected explicitly when creating the domain. |
| **ACME Email** | Certificate expiration notifications (currently unused) |
| **ACME Directory** | CA endpoint, Let's Encrypt Production/Staging (currently unused) |
| **Cloudflare API Email** | Cloudflare account email, sent as the `X-Auth-Email` header — optional unless using Cross-Site DNS |
| **Cloudflare API Key** | Cloudflare **User API Token**, sent as `Authorization: Bearer <token>`. Despite the field name, this is *not* the legacy Global API Key. Optional unless using Cross-Site DNS. |
| **oauth2-proxy URL** | Optional — upstream URL of an [oauth2-proxy](https://oauth2-proxy.github.io/oauth2-proxy/) server for NGINX `auth_request`. See [Authentication](#authentication) |

!!! tip
    Use Let's Encrypt **Staging** for testing — it has higher rate limits. Switch to **Production** once verified.

## Setup

1. Add your domain to Cloudflare and update nameservers
2. (Optional, for Cross-Site DNS) Create a Cloudflare **User API Token** with `Zone:DNS:Edit` permission for the zone
3. In the admin interface, navigate to **External Domains** → **New External Domain**
4. Enter domain name, default site, ACME email, ACME directory, and Cloudflare email + API token (if used)
5. Select **Create External Domain**

Wildcard DNS (`*.example.com`) is assumed to point to the default site's IP.

## SSL Certificate Provisioning

SSL certificates are managed manually using [acme.sh](https://github.com/acmesh-official/acme.sh), which is pre-installed on all agent and manager containers. NGINX reads certificates from standard locations:

| File | Path |
|------|------|
| Certificate (fullchain) | `/etc/ssl/certs/<domain>.crt` |
| Private key | `/etc/ssl/private/<domain>.key` |

### Issue a Certificate

Run on each agent and manager container that serves traffic for the domain:

```bash
export CF_Token="your_cloudflare_api_token"
export CF_Account_ID="your_cloudflare_account_id"

acme.sh --issue --dns dns_cf -d example.com -d '*.example.com'
```

### Install the Certificate

After issuing, install the certificate to the standard locations and configure automatic NGINX reload on renewal:

```bash
acme.sh --install-cert -d example.com \
  --fullchain-file /etc/ssl/certs/example.com.crt \
  --key-file /etc/ssl/private/example.com.key \
  --reloadcmd "nginx -s reload"
```

acme.sh stores this configuration and automatically renews the certificate and runs the reload command on renewal.

### Verify

```bash
nginx -t && nginx -s reload
curl -vI https://example.com 2>&1 | grep 'subject:'
```

## Cross-Site DNS

When an HTTP service uses an external domain on a site that is **not** the domain's default site, the system automatically creates a Cloudflare A record pointing `hostname.domain` to the service's site `externalIp`.

```mermaid
flowchart LR
    A[Container on Site B] -->|HTTP service: app.example.com| B{Is Site B the default site?}
    B -->|Yes| C[DNS assumed pre-configured]
    B -->|No| D[Create Cloudflare A record<br/>app.example.com → Site B externalIp]
```

**Requirements for cross-site DNS:**
- The external domain must have Cloudflare API credentials configured
- The container's site must have an **External IP** configured (set in Site settings)

DNS operations are **optimistic and non-fatal**. If Cloudflare API calls fail during container create, edit, or delete, the lifecycle operation completes and a warning is shown. Server logs contain full debug detail.

## How It Works

When a container exposes an HTTP service on an external domain:

1. DNS records and reverse proxy routing configured automatically
2. Cross-site A records created if the service's site ≠ domain's default site

On container or service deletion, cross-site A records are cleaned up automatically.

## Using with Services

When creating a container service, users select an external domain and specify a subdomain (e.g., `app` for `app.example.com`). All external domains are available regardless of which site the container is on. See the [Web GUI guide](../../users/creating-containers/web-gui.md) for details.

## Security

- Issue Cloudflare User API Tokens with minimum scope (`Zone:DNS:Edit` for the target zone only)
- Rotate tokens periodically; revoke immediately if compromised
- Private keys never leave the cluster

## Authentication

HTTP services can require authentication via NGINX's [`auth_request`](https://nginx.org/en/docs/http/ngx_http_auth_request_module.html) module, delegated to an [oauth2-proxy](https://oauth2-proxy.github.io/oauth2-proxy/) server that you run and configure. When a service has **Require auth** enabled, NGINX authenticates each request against oauth2-proxy's `/oauth2/auth` endpoint before proxying. Unauthenticated users are redirected to oauth2-proxy's sign-in page.

The manager does **not** provide authentication itself — you must deploy and configure a valid oauth2-proxy server (with your chosen OIDC/OAuth2 provider) and point the domain's **oauth2-proxy URL** at it.

### Configuring oauth2-proxy

Set the domain's **oauth2-proxy URL** to the upstream address of your oauth2-proxy instance (e.g. `http://127.0.0.1:4180`). NGINX proxies the `/oauth2/` paths on each authenticated service's host to this upstream, so the OAuth2 endpoints are served on the same hostname as the application.

Run oauth2-proxy with at least:

- `--reverse-proxy=true` — required when behind NGINX.
- `--set-xauthrequest=true` — so identity is returned in `X-Auth-Request-*` response headers (forwarded to the backend).
- `--pass-access-token=true` *(optional)* — to forward the access token as `X-Access-Token`.

See the [oauth2-proxy NGINX integration guide](https://oauth2-proxy.github.io/oauth2-proxy/configuration/integrations/nginx/) for full configuration details.

### Identity Headers

When oauth2-proxy runs with `--set-xauthrequest`, NGINX captures its `X-Auth-Request-*` response headers and forwards them to the backend under a **stable header contract** (so the backend sees the same names regardless of the auth provider):

| Header forwarded to backend | Source (oauth2-proxy response) |
|-----------------------------|--------------------------------|
| `X-User` | `X-Auth-Request-User` |
| `X-Email` | `X-Auth-Request-Email` |
| `X-Groups` | `X-Auth-Request-Groups` |
| `X-Access-Token` | `X-Auth-Request-Access-Token` (with `--pass-access-token`) |

### Cookie Domain

Because oauth2-proxy is served on the same hostname as each application (via the `/oauth2/` proxy), its session cookie is scoped to that host by default. To share a single sign-in session across multiple subdomains of the external domain, configure oauth2-proxy with a parent `--cookie-domain` (e.g. `.example.com`) and a `--whitelist-domain` for the redirect targets.

### Flow

```mermaid
sequenceDiagram
    participant Client
    participant NGINX
    participant OAuth2Proxy as oauth2-proxy
    participant Backend

    Client->>NGINX: GET app.example.com/page
    NGINX->>OAuth2Proxy: auth_request → GET /oauth2/auth (subrequest)
    alt 202 (authenticated)
        OAuth2Proxy-->>NGINX: 202 + X-Auth-Request-* headers
        NGINX->>Backend: Proxied request + identity headers
        Backend-->>NGINX: Response
        NGINX-->>Client: Response
    else 401 (unauthenticated)
        OAuth2Proxy-->>NGINX: 401
        NGINX-->>Client: 302 → /oauth2/sign_in?rd=original_url
    end
```

If **Require auth** is enabled but no **oauth2-proxy URL** is configured on the domain, NGINX serves a 503 "Authentication Unavailable" page.

