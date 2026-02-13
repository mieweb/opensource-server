---
sidebar_position: 0
---

# Core Concepts

The cluster is organized: **Sites** → **Nodes** → **Containers**

- **[Users & Groups](users-and-groups)** — Accounts, groups, LDAP authentication
- **[Sites](sites)** — Network configuration, DHCP, DNS
- **[External Domains](external-domains)** — Public domains with automatic SSL/TLS
- **[Nodes](nodes)** — Proxmox VE servers within a site
- **[Containers](containers)** — LXC instances on nodes ([user guide](/docs/users/creating-containers/web-gui))

**Setup order:** Users & Groups → Sites → External Domains (optional) → Nodes → Containers
