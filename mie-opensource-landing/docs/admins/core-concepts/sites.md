
# Sites

A site groups Proxmox nodes, defines network configuration, and manages container networking. Create at least one site before adding nodes.

## Site Properties

| Field | Description | Example |
|-------|-------------|---------|
| **Site Name** | Human-readable name | `Production Cluster` |
| **Internal Domain** | DNS domain for internal network | `cluster.example.internal` |
| **DHCP Range** | IP range for containers | `192.168.100.100,192.168.100.200` |
| **Subnet Mask** | Network mask | `255.255.255.0` |
| **Gateway** | Default gateway | `192.168.100.1` |
| **DNS Forwarders** | Upstream DNS (comma-separated) | `8.8.8.8,1.1.1.1` |
| **External IP** | Public IP used for cross-site DNS records pointing to services on this site | `203.0.113.10` |

## Creating a Site

1. Navigate to **Sites** → **New Site**
2. Enter site name and internal domain
3. Configure DHCP range, subnet mask, gateway, DNS forwarders, and external IP
4. Select **Create Site**

!!! warning "Important"
    Ensure the DHCP range doesn't conflict with static IPs (Proxmox nodes, management container, infrastructure devices).

## DHCP and DNS

- Containers automatically receive IPs from the DHCP range
- Internal DNS resolves `container-name.INTERNAL_DOMAIN`
- External queries forwarded to configured DNS forwarders
- All records created/removed automatically with container lifecycle
