---
sidebar_position: 2
---

# Core Concepts

Understanding the data model and organizational structure is essential for effectively administering the MIE Opensource Proxmox Cluster. This section covers the key concepts you'll work with daily.

## Organizational Hierarchy

The cluster management system is organized hierarchically:

**Sites** → **Nodes** → **Containers**

Each level serves a specific purpose in managing your infrastructure.

## Key Concepts

### [Users & Groups →](users-and-groups)

User accounts and group-based permissions for access control and LDAP authentication.

### [Sites →](sites)

Top-level organization units that define network configuration and house nodes and containers.

### [External Domains →](external-domains)

Domain configuration for exposing HTTP services with automatic SSL/TLS certificate management.

### [Nodes →](nodes)

Individual Proxmox VE servers within a site that host containers.

### [Containers →](containers)

Linux containers (LXC) running on nodes - see the [User Documentation](/docs/users/creating-containers/web-gui) for creation guides.

---

## Getting Started

New administrators should configure these elements in order:

1. **Users & Groups**: Set up your team's accounts and permissions
2. **Sites**: Create your first site with network configuration
3. **External Domains**: Configure domains for service exposure (optional)
4. **Nodes**: Import or add your Proxmox nodes
5. **Containers**: Begin deploying containers for your users

Each concept page includes detailed explanations and step-by-step guides for using the web interface.
