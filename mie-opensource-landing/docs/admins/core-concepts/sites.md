---
sidebar_position: 4
---

# Sites

A site groups Proxmox nodes, defines network configuration, and manages container networking. Create at least one site before adding nodes.

## Site Properties

| Field | Description | Example |
|-------|-------------|---------|
| **Display Name** | Human-readable name | `Production Cluster` |
| **Internal Domain** | DNS domain for internal network | `cluster.example.internal` |
| **DHCP Range** | IP range for containers | `192.168.100.100-192.168.100.200` |
| **Subnet Mask** | Network mask | `255.255.255.0` |
| **Gateway IP** | Default gateway | `192.168.100.1` |
| **DNS Forwarders** | Upstream DNS (comma-separated) | `8.8.8.8,1.1.1.1` |

## Creating a Site

1. Navigate to **Sites** → **Create New Site**
2. Enter display name and internal domain
3. Configure DHCP range, subnet mask, gateway, and DNS forwarders
4. Save

:::important
Ensure the DHCP range doesn't conflict with static IPs (Proxmox nodes, management container, infrastructure devices).
:::

## DHCP and DNS

- Containers automatically receive IPs from the DHCP range
- Internal DNS resolves `container-name.INTERNAL_DOMAIN`
- External queries forwarded to configured DNS forwarders
- All records created/removed automatically with container lifecycle
