---
sidebar_position: 4
---

# Sites

A site is the top-level organizational unit that groups Proxmox nodes, defines network configuration, and manages container networking. You must create at least one site before adding nodes or deploying containers.

## What is a Site?

A site represents a physical or logical cluster location with its own:
- Network subnet and DHCP configuration
- Proxmox node(s)
- Container deployments
- External domain mappings

Sites enable you to manage multiple independent Proxmox clusters from a single management interface.

## Site Properties

When creating a site, you must configure:

### Basic Information

- **Display Name**: A human-readable name for the site (e.g., "Production Cluster", "Development Lab")

### Network Configuration

- **Internal Domain Name**: The DNS domain for the cluster's internal network
  - Recommended: `cluster.yourdomain.tld`
  - If you don't own a domain, use IANA-defined local domains like `.internal`, `.local`, or `.home.arpa`

- **DHCP Range**: The IP address range for automatic container assignment
  - Must be within the site's subnet
  - Format: `192.168.1.100-192.168.1.200`

- **Subnet Mask**: The network subnet mask (e.g., `255.255.255.0` or `/24`)

- **Gateway IP**: The default gateway for the network (typically your router)

- **DNS Forwarders**: Upstream DNS servers for resolving external domains
  - Can specify multiple servers separated by commas
  - Example: `8.8.8.8,1.1.1.1`

## Creating a Site

Follow these steps to create your first site:

### 1. Access Site Management

1. Log in to the administration interface
2. Navigate to **Sites** in the main menu
3. Click **Create New Site**

### 2. Configure Basic Settings

1. Enter a descriptive **Display Name**
2. Set your **Internal Domain Name** (e.g., `cluster.example.internal`)

:::tip Domain Selection
If you own a domain, using a subdomain like `cluster.yourdomain.tld` allows you to create valid SSL certificates. For purely internal deployments, `.internal` is recommended per RFC 8375.
:::

### 3. Configure Networking

Configure the network settings based on your infrastructure:

**Example Configuration:**
```
DHCP Range: 192.168.100.100-192.168.100.200
Subnet Mask: 255.255.255.0 (or /24)
Gateway IP: 192.168.100.1
DNS Forwarders: 8.8.8.8,1.1.1.1
```

:::important Network Isolation
Ensure the DHCP range does not conflict with:
- Static IPs assigned to Proxmox nodes
- The management container's IP address
- Any other static infrastructure devices
:::

### 4. Save and Verify

1. Click **Save** to create the site
2. Verify the site appears in the sites list
3. Check that network settings are correct

## DHCP and IP Management

The cluster management system handles DHCP for containers automatically:

- When a user creates a container, an IP is automatically assigned from the DHCP range
- IP assignments are tracked to prevent conflicts
- Containers receive DNS configuration pointing to the internal DNS server
- The gateway and subnet mask are automatically applied

### Static IP Addresses

While containers typically use DHCP, you can configure static IPs outside the DHCP range for:
- Load balancers
- Database servers
- Other infrastructure components requiring fixed addresses

## DNS Configuration

The internal DNS server provides:

- Name resolution for containers within the site: `container-name.cluster.example.internal`
- Forwarding for external domains to the configured DNS forwarders
- Automatic DNS record creation when containers are deployed

## Multiple Sites

You can create multiple sites to manage separate clusters:

- **Geographical separation**: Different physical locations
- **Environment separation**: Production vs. Development vs. Testing
- **Network isolation**: Different security zones or network segments

Each site operates independently with its own:
- Network configuration
- Nodes and containers
- External domain mappings

## Next Steps

After creating a site:

1. **[External Domains](external-domains)**: Configure domains for exposing HTTP services (optional)
2. **[Nodes](nodes)**: Import your Proxmox nodes into the site
3. **[Containers](containers)**: Begin deploying containers on your nodes

## Troubleshooting

### DHCP Range Exhausted

If you run out of DHCP addresses:
1. Edit the site configuration
2. Expand the DHCP range (ensure no conflicts)
3. Save changes

### DNS Resolution Issues

If containers can't resolve external domains:
- Verify DNS forwarders are reachable from the Proxmox nodes
- Test DNS resolution: `dig @8.8.8.8 google.com`
- Check that the internal DNS server is running

### Gateway Unreachable

If containers can't reach the internet:
- Verify the gateway IP is correct
- Ensure Proxmox nodes can reach the gateway
- Check firewall rules on the gateway device
