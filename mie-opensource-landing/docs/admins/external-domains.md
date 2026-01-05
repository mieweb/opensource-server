---
sidebar_position: 5
---

# External Domains

External domains enable you to expose HTTP/HTTPS services running in containers to the internet with automatic SSL/TLS certificate management.

## What is an External Domain?

An external domain is a public domain name (e.g., `example.com`) configured to:
- Route traffic to services running in containers
- Automatically obtain and renew SSL/TLS certificates via ACME (Let's Encrypt, etc.)
- Support multiple services on subdomains

External domains are associated with a specific site and can be used by any container within that site.

## Prerequisites

Before configuring an external domain, you need:

- **A registered domain**: Ownership of a public domain name
- **Cloudflare account**: Currently the only supported DNS provider for automatic certificate validation
- **Cloudflare API credentials**: Token or API key for DNS-01 challenge authentication

:::note DNS Provider Support
Only Cloudflare is currently supported for automatic certificate management. If you use another DNS provider, you'll need to manage SSL certificates manually.
:::

## Domain Properties

An external domain requires:

### Basic Configuration

- **Domain**: The top-level domain (e.g., `example.com` or `example.org`)
- **Site**: The site this domain is associated with

### ACME (Certificate Management)

- **ACME Email**: Email address for certificate expiration notifications
- **ACME Directory**: The certificate authority endpoint
  - Let's Encrypt Production (recommended for live services)
  - Let's Encrypt Staging (for testing)
  - Other ACME-compatible providers

- **Cloudflare API Token**: API credentials for DNS-01 challenge
  - Can use either an API Token (recommended) or API Key

:::tip ACME Directory Selection
Use Let's Encrypt **Staging** initially to test your configuration. Staging has higher rate limits and won't count against production quotas. Switch to **Production** once verified.
:::

## Creating an External Domain

### 1. Prepare Cloudflare

Before adding the domain to the cluster:

1. Add your domain to Cloudflare
2. Update your domain registrar's nameservers to Cloudflare's nameservers
3. Create a Cloudflare API token with **Zone:DNS:Edit** permissions for the domain

:::important API Token Permissions
The API token must have permission to create and delete DNS TXT records for the domain. This is required for the DNS-01 ACME challenge.
:::

### 2. Add Domain to Site

1. Log in to the administration interface
2. Navigate to **External Domains**
3. Click **Create New External Domain**

### 3. Configure Domain Settings

Enter the configuration:

**Example:**
```
Domain: example.com
ACME Email: admin@example.com
ACME Directory: Let's Encrypt Production
Cloudflare API Token: [your-api-token]
Site: Production Cluster
```

### 4. Save and Test

1. Click **Save** to create the external domain
2. The system will validate Cloudflare API access
3. Certificates will be requested automatically when services are exposed

## How Certificate Management Works

When a container exposes an HTTP service using the external domain:

1. The service is configured (e.g., `app.example.com`)
2. The system initiates an ACME certificate request
3. A DNS-01 challenge is created via Cloudflare API
4. The certificate authority validates ownership via DNS
5. Certificate is issued and automatically installed
6. Certificate auto-renews before expiration (typically every 60 days)

:::tip DNS-01 vs HTTP-01
DNS-01 challenges work even when the service isn't publicly accessible yet, making them ideal for clustered environments. They also support wildcard certificates.
:::

## Using External Domains with Services

When creating a service in a container, users can:

1. Select the external domain from a dropdown
2. Specify a subdomain (e.g., `app` for `app.example.com`)
3. The system automatically:
   - Creates DNS records in Cloudflare
   - Requests SSL certificate via ACME
   - Configures reverse proxy routing

See the [User Documentation](/docs/users/creating-containers/basic-containers/web-gui) for details on exposing services.

## Multiple External Domains

You can configure multiple external domains per site:

- Different top-level domains (e.g., `example.com` and `example.org`)
- Development vs. production domains
- Customer-specific domains in multi-tenant setups

Each domain manages its own certificates and DNS configuration.

## Supported ACME Directories

Common ACME certificate authorities:

| Provider | Directory URL | Rate Limits | Notes |
|----------|--------------|-------------|-------|
| **Let's Encrypt Production** | `https://acme-v02.api.letsencrypt.org/directory` | 50 certs/week per domain | Recommended for production |
| **Let's Encrypt Staging** | `https://acme-staging-v02.api.letsencrypt.org/directory` | Higher limits | For testing only |
| **ZeroSSL** | `https://acme.zerossl.com/v2/DV90` | Varies | Alternative CA |

:::warning Rate Limits
Let's Encrypt production has rate limits. Use staging for testing to avoid hitting limits during setup and debugging.
:::

## Security Considerations

### API Token Security

- Store Cloudflare API tokens securely
- Use tokens with minimal required permissions (Zone:DNS:Edit only)
- Rotate tokens periodically
- Revoke tokens immediately if compromised

### Certificate Management

- Certificates are stored securely on the management container
- Private keys never leave the cluster
- Automatic renewal prevents expiration
- Expiration notifications sent to ACME email address

### DNS Security

- Enable DNSSEC in Cloudflare for additional security
- Monitor DNS changes for unauthorized modifications
- Use Cloudflare's security features (WAF, DDoS protection)

## Troubleshooting

### Certificate Request Fails

**Check Cloudflare API token:**
```bash
# Test API token access
curl -X GET "https://api.cloudflare.com/client/v4/zones" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Common issues:**
- Invalid or expired API token
- Insufficient token permissions
- Cloudflare nameservers not yet active for domain
- Domain not added to Cloudflare account

### DNS-01 Challenge Fails

- Verify DNS propagation: `dig TXT _acme-challenge.example.com`
- Check Cloudflare proxy status (should be DNS only for validation)
- Ensure no conflicting DNS records exist
- Wait for DNS propagation (can take minutes to hours)

### Rate Limit Exceeded

If you hit Let's Encrypt rate limits:
- Switch to staging directory for testing
- Wait for rate limit window to reset (weekly for most limits)
- Consider using a different subdomain for testing

### Certificate Not Renewing

- Check ACME email for renewal failure notifications
- Verify Cloudflare API token is still valid
- Check system logs for renewal errors
- Manually trigger renewal if needed

## Next Steps

After configuring external domains:

1. **[Nodes](nodes)**: Import your Proxmox nodes
2. **[Containers](containers)**: Deploy containers and expose services
3. Review the [User Documentation](/docs/users/creating-containers/basic-containers/web-gui) for service exposure guides
