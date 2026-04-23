
# Core Concepts

The cluster is organized: **Sites** → **Nodes** → **Containers**

- **[Users & Groups](users-and-groups.md)** — Accounts, groups, LDAP authentication
- **[Sites](sites.md)** — Network configuration, DHCP, DNS
- **[External Domains](external-domains.md)** — Public domains with automatic SSL/TLS
- **[Nodes](nodes.md)** — Proxmox VE servers within a site
- **[Containers](containers.md)** — LXC instances on nodes ([user guide](../../users/creating-containers/web-gui.md))

**Setup order:** Users & Groups → Sites → External Domains (optional) → Nodes → Containers
