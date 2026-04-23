
# Containers

Containers are LXC instances running on Proxmox nodes. For creating and managing containers, see the [Web GUI Guide](../../users/creating-containers/web-gui.md) or [Command Line Guide](../../users/creating-containers/command-line.md).

## LDAP Authentication

Users in the **ldapusers** group can SSH into any container using their cluster credentials. Group memberships and password changes propagate automatically.

## Container States

| State | Description |
|-------|-------------|
| **Running** | Active and accessible via SSH/web |
| **Stopped** | Stopped but not deleted |
| **Creating** | Being provisioned |
| **Failed** | Creation or startup failed |

## Service Exposure

Users can expose HTTP services from containers using [external domains](external-domains.md). Services are automatically configured with SSL/TLS certificates, reverse proxy routing, and DNS records.

HTTP services can optionally require authentication via the **Require auth** checkbox. When enabled, NGINX authenticates requests against the domain's [auth server](external-domains.md#authentication) before proxying. Authenticated requests include identity headers (`X-User-ID`, `X-Username`, etc.) forwarded to the backend. See [External Domains — Authentication](external-domains.md#authentication) for configuration details.

