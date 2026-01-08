---
sidebar_position: 1
---

# Installation Guide

This guide walks you through installing and configuring the MIE Opensource Proxmox Cluster management system on your Proxmox VE infrastructure.

## Prerequisites

### System Requirements

- **Proxmox VE 13 or higher**: Required for OCI (Open Container Initiative) image support
- **Isolated Network**: A network segment dedicated to the Proxmox cluster with no existing DHCP infrastructure
- **Network Access**: Ability to connect to the Proxmox host via:
  - SSH (typically port-forwarded)
  - Web UI on 8006/tcp (typically port-forwarded)

### Before You Begin

Ensure you have:
- Administrative access to your Proxmox VE cluster
- Network connectivity to reach the Proxmox management interface
- A subnet range allocated for the cluster (the management container will need a static IP in this range)

## Installation Steps

### 1. Pull the OCI Image

Connect to your Proxmox VE host via SSH and pull the container image from the GitHub Container Registry.

Proxmox uses `skopeo` to pull OCI images. First, ensure skopeo is installed:

```bash
# Install skopeo if not already present
apt update && apt install -y skopeo
```

Then pull the image to your template storage:

```bash
# Pull the OCI image to Proxmox template cache
skopeo copy docker://ghcr.io/mieweb/opensource-server:latest \
  oci-archive:/var/lib/vz/template/cache/opensource-server.tar
```

:::tip Using the Web UI
You can also pull OCI images through the Proxmox web interface:
1. Navigate to your storage location (e.g., `local`)
2. Click **CT Templates**
3. Use the **Download from URL** option with the OCI registry reference
:::

This downloads the pre-built container image to your Proxmox host's template storage.

### 2. Create the Management Container

Launch a new container based on the pulled image:

1. Navigate to the Proxmox web interface at `https://your-proxmox-host:8006`
2. Select your node in the left sidebar
3. Click **Create CT** to open the container creation wizard
4. Configure the container:
   - **Template**: Select the `opensource-server:latest` image from OCI registry
   - **Hostname**: Choose a meaningful hostname (e.g., `cluster-admin`)
   - **Network**: Configure with a **static IP address** in the same subnet as your Proxmox VE server(s)
   - **Resources**: Allocate appropriate CPU, memory, and storage based on expected usage

:::important Static IP Required
The management container must have a static IP address. The container comes with a DNSMasq instance to manage DHCP within the network.
:::

### 3. Configure Network Access

Set up port forwarding to make the management interface accessible, exact steps will depend on your firewall platform. The specific port forwarding configuration depends on your network setup. At minimum, forward:
- **443/tcp**: HTTPS access to the web-based administration GUI

:::tip Additional Ports
Depending on your deployment needs, you may also want to forward:
- **22/tcp**: SSH access to the management container
- **80/tcp**: HTTP access (will redirect to HTTPS)
:::

### 4. Start the Container

Once configured, start the management container:

```bash
pct start <container-id>
```

The container will initialize and start the cluster management services.

### 5. Initial Account Setup

Navigate to the management GUI via the forwarded HTTPS port:

```
https://your-external-address:443
```

:::important First Account Registration
Register a new account through the web interface. The **first account registered** will be:
- Automatically approved (no manual approval required)
- Granted full administrative privileges
- Able to manage all cluster resources and user accounts
:::

**Important**: Ensure you register the intended administrator account first, as it will receive elevated privileges automatically.

## Next Steps

Once logged in with your administrative account, proceed to the [Concepts](/docs/admins/concepts) guide to understand the architecture and key concepts of the cluster management system.

You'll learn about:
- Cluster organization and node management
- User roles and permissions
- Container lifecycle management
- Service exposure and networking
- Monitoring and maintenance

## Troubleshooting

### Cannot Access the Management GUI

- Verify port forwarding is correctly configured
- Check that the container is running: `pct status <container-id>`
- Ensure the static IP address is reachable from your location
- Review container logs: `pct logs <container-id>`

### OCI Image Pull Fails

- Verify internet connectivity from the Proxmox host
- Ensure Proxmox VE is version 13 or higher: `pveversion`
- Check that the container registry is accessible
- Try pulling the image manually with verbose output

### Container Won't Start

- Check container configuration: `pct config <container-id>`
- Review system logs for errors
- Verify sufficient resources are available on the host
- Ensure no IP address conflicts exist on the network

## Getting Help

For installation issues or questions:
- Review the detailed error messages in Proxmox logs
- Check the [GitHub repository](https://github.com/mieweb/opensource-server) for known issues
- Contact the MIE team for assistance
