---
sidebar_position: 5
---

# External Domains

External domains expose container HTTP services to the internet with automatic SSL/TLS certificate management via ACME (Let's Encrypt). Domains are associated with a site and available to all containers within it.

## Prerequisites

- A registered domain with Cloudflare DNS (only supported provider)
- Cloudflare API token with **Zone:DNS:Edit** permissions

## Domain Properties

| Field | Description |
|-------|-------------|
| **Domain** | Top-level domain (e.g., `example.com`) |
| **Site** | Associated site |
| **ACME Email** | Certificate expiration notifications |
| **ACME Directory** | CA endpoint (Let's Encrypt Production/Staging) |
| **Cloudflare API Token** | For DNS-01 challenge authentication |

:::tip
Use Let's Encrypt **Staging** for testing — it has higher rate limits. Switch to **Production** once verified.
:::

:::warning
If you don't configure ACME, you'll need to manage SSL certificates manually. Instructions for doing so are out-of-scope for this documentation.
:::

## Setup

1. Add your domain to Cloudflare and update nameservers
2. Create a Cloudflare API token with **Zone:DNS:Edit** permissions
3. In the admin interface, navigate to **External Domains** → **Create New External Domain**
4. Enter domain, ACME email, ACME directory, Cloudflare API token, and site
5. Save — the system validates Cloudflare API access automatically

## How It Works

When a container exposes an HTTP service on an external domain:

1. DNS-01 challenge created via Cloudflare API
2. Certificate issued and auto-installed
3. Certificates auto-renew before expiration (~every 60 days)
4. DNS records and reverse proxy routing configured automatically

## Using with Services

When creating a container service, users select an external domain and specify a subdomain (e.g., `app` for `app.example.com`). DNS records, SSL certificates, and reverse proxy routing are all configured automatically. See the [Web GUI guide](/docs/users/creating-containers/web-gui) for details.

## Security

- Store Cloudflare API tokens with minimal permissions (Zone:DNS:Edit only)
- Rotate tokens periodically; revoke immediately if compromised
- Private keys never leave the cluster

