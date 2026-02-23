---
sidebar_position: 1
---

# Installation Guide

## Prerequisites

- **Proxmox VE 13+** (required for OCI image support)
- **Isolated network** with no existing DHCP infrastructure
- SSH and web UI access (port 8006) to the Proxmox host

## Installation Steps

### 1. Pull the OCI Image

```bash
apt update && apt install -y skopeo

skopeo copy docker://ghcr.io/mieweb/opensource-server/manager:latest \
  oci-archive:/var/lib/vz/template/cache/manager_latest.tar
```

### 2. Create the Management Container

In the Proxmox web interface (`https://your-proxmox-host:8006`):

1. **Create CT** on your node
2. **Template**: Select `manager_latest.tar`
3. **Network**: Configure with a **static IP** in the same subnet as your Proxmox server(s)
4. **Resources**: Allocate CPU, memory, and storage as needed

:::important Static IP Required
The management container must have a static IP. It runs a DNSMasq instance to manage DHCP within the network.
:::

### 3. Configure Network Access

Forward at minimum **443/tcp** (HTTPS) to the management container. Optionally forward **22/tcp** (SSH) and **80/tcp** (HTTP redirect).

### 4. Start the Container

```bash
pct start <container-id>
```

### 5. Initial Account Setup

Navigate to `https://your-external-address:443` and register an account.

:::important First Account
The **first account registered** is automatically approved with full admin privileges. Register the intended administrator account first.
:::

Once logged in, proceed to [Core Concepts](core-concepts) to configure your first site.

