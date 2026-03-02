---
sidebar_position: 6
---

# Nodes

Nodes are Proxmox VE servers within a site that host containers.

## Node Properties

- **Name**: Must exactly match the Proxmox hostname
- **IP Address**: For internal DNS resolution
- **API URL**: e.g., `https://192.168.1.10:8006/api2/json`
- **Authentication**: Username/password or API token
- **TLS Verification**: Enable/disable certificate validation
- **Template Storage**: Proxmox storage for CT template images (`vztmpl` content)
- **Volume Storage**: Proxmox storage for container root filesystems (`rootdir` content)

## Adding Nodes

### Import Nodes (Recommended)

Discovers all nodes in a Proxmox cluster automatically:

1. Navigate to **Nodes** → select site → **Import Nodes**
2. Enter API URL of any node, credentials, and TLS setting
3. Click **Import** — all cluster nodes are discovered and imported

:::tip
Import only needs credentials for one node. It discovers all other nodes in the same cluster.
:::

### Manual Node Creation

1. Navigate to **Nodes** → select site → **Create New Node**
2. Enter name (must match Proxmox hostname exactly), IP, API URL, and credentials

:::important
Name mismatches cause API communication failures.
:::

## Authentication

Use `root@pam` credentials for both import and manual node creation. The Proxmox API requires root-level access to configure container settings needed for nested containerization.

**Username & Password:**
```
Username: root@pam
Password: your-root-password
```

## TLS Verification

Proxmox uses self-signed certificates by default. Either disable TLS verification (acceptable for isolated networks) or install valid certificates from a trusted CA (recommended for production).

## Managing Nodes

- **Edit**: Update credentials or settings from the node detail page
- **Delete**: Remove a node (must have no active containers first)
- **Multi-node**: Proxmox supports HA features — see [Proxmox HA docs](https://pve.proxmox.com/wiki/High_Availability)

## Storage Configuration

Nodes have two storage settings because most Proxmox storage types only support one content type.

| Setting | Content Type | Default | Purpose |
|---|---|---|---|
| **Template Storage** | `vztmpl` | `local` | Stores pulled Docker/OCI images as CT templates |
| **Volume Storage** | `rootdir` | `local-lvm` | Stores container root filesystems |

If a configured storage does not support the required content type, the system falls back to the largest enabled storage on the node that does. If no storage supports the required content type, container creation fails.

To verify storage content types in Proxmox, navigate to **Datacenter → Storage** and check the **Content** column.

