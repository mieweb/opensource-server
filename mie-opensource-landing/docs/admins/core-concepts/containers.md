---
sidebar_position: 7
---

# Containers

Containers are LXC instances running on Proxmox nodes. For creating and managing containers, see the [Web GUI Guide](/docs/users/creating-containers/web-gui) or [Command Line Guide](/docs/users/creating-containers/command-line).

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

Users can expose HTTP services from containers using [external domains](external-domains). Services are automatically configured with SSL/TLS certificates, reverse proxy routing, and DNS records.

