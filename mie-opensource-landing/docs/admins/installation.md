# Installation Guide

## Prerequisites

- **Proxmox VE 9+** (required for OCI image support)
- **Isolated network** with no existing DHCP infrastructure
- SSH and web UI access (port 8006) to the Proxmox host

## Assumptions

The following instructions make several assumptions for clarity. You may have to adapt them for your deployment.

1. You are using the Proxmox default `local` storage at `/var/lib/vz` for all operations.
2. You are using the Proxmox default `vmbr0` network on the `10.0.0.0/16` subnet. The gateway is at `10.0.0.1` and the Proxmox host is at `10.0.0.2`.
3. The Manager container uses container ID `100`.
4. The domains `example.org` and `*.example.org` have public DNS entries pointing to the firewall in front of this Proxmox cluster.
5. At least one Proxmox node is accessible at `https://example.org:8006` with a valid HTTPS certificate.

## Air-Gapped Installation

The standard installation flow assumes that the Proxmox host can access GitHub Container Registry (GHCR). For an air-gapped deployment, container images must instead be downloaded on an Internet-connected machine and transferred into the isolated Proxmox network.

The following procedure was tested using a single Proxmox node on an isolated network.

### Tested Network Layout

| System | Address | Purpose |
|---|---|---|
| Proxmox node (`pve01`) | `10.100.0.2/16` | Proxmox host |
| Manager container | `10.100.0.3/16` | MIE Manager |
| Staging laptop | `10.100.0.50/16` | Downloads and transfers OCI images |

The isolated network was not connected to an upstream router or DHCP server.

!!! warning "Keep the Network Isolated"
    Manager provides DHCP for workloads. Do not connect this network to another network that already provides DHCP unless the network design has been reviewed.

### 1. Download the Manager OCI Image

On an Internet-connected Linux machine, or Windows using WSL, install `skopeo` and download the Manager image as an OCI archive:

```bash
skopeo copy \
  docker://ghcr.io/mieweb/opensource-server/manager:latest \
  oci-archive:manager_latest.tar
```

This creates:

```text
manager_latest.tar
```

The Proxmox host itself does not require Internet access for this step.

### 2. Transfer the Image to Proxmox

Connect the staging machine to the isolated Proxmox network.

Transfer the OCI archive into the Proxmox template cache:

```bash
scp manager_latest.tar \
  root@10.100.0.2:/var/lib/vz/template/cache/
```

Adjust the Proxmox address and storage path for your deployment.

Verify that Proxmox recognizes the archive:

```bash
pvesm list local --content vztmpl
```

The output should include:

```text
local:vztmpl/manager_latest.tar
```

### 3. Create the Manager Container

Create the Manager container from the transferred OCI archive:

```bash
pct create 100 local:vztmpl/manager_latest.tar \
  --cores=4 \
  --features=nesting=1 \
  --hostname=manager \
  --memory=8192 \
  --net0=name=eth0,bridge=vmbr0,ip=10.100.0.3/16 \
  --onboot=1 \
  --ostype=debian \
  --rootfs=local-lvm:50
```

!!! note "Container Storage"
    The tested Proxmox installation used `local-lvm` for the container root filesystem because the default `local` storage was configured for templates, ISOs, backups, and imports but did not support container root filesystems.

    Use a Proxmox storage target that supports `rootdir` on your installation.

!!! note "No Gateway"
    No gateway was configured on the Manager container because the tested network was fully isolated.

### 4. Start and Verify the Manager Container

Start the Manager:

```bash
pct start 100
```

Verify its status:

```bash
pct status 100
```

Verify its network configuration:

```bash
pct exec 100 -- ip -br addr
```

The Manager should have its configured static address. In the tested environment:

```text
10.100.0.3/16
```

Verify connectivity from the Proxmox host:

```bash
ping 10.100.0.3
```

### 5. Access Manager

In the tested air-gapped installation, the Manager application was reachable directly on port `3000`:

```text
http://10.100.0.3:3000
```

Register the first administrator account.

!!! warning "First Account"
    The first account registered is automatically approved with administrator privileges. Register the intended administrator account first.

!!! warning "HTTPS bootstrap"
    In the tested environment, `manager:latest` exposed the UI on `http://10.100.0.3:3000` (HTTP), not HTTPS on `:443` as described in the standard installation steps.

    If your image exposes HTTPS on `:443`, access the UI via `https://<manager-ip>:443` instead and keep TLS verification enabled when using a trusted certificate.

### 6. Configure the First Site

Create a site using settings appropriate for the isolated network.

The tested configuration used:

```text
Site Name: MIE Lab
Internal Domain: cluster.mieweb.org
DHCP Range: 10.100.1.1,10.100.254.254
Subnet Mask: 255.255.0.0
External IP: blank
```

For a truly isolated network, there may be no real gateway or upstream DNS forwarder.

!!! warning "Current Air-Gapped DHCP Limitation"
    Manager currently requires gateway and DNS forwarder values before the agent applies its dnsmasq configuration.

    This prevents DHCP from operating normally when those values are intentionally absent on an isolated network.

    This is tracked in [#455](https://github.com/mieweb/opensource-server/issues/455).

    Gateway and DNS values should be treated as optional for a fully isolated deployment once this issue is resolved.

### 7. Import the Proxmox Node

In Manager, select **Import Nodes** and enter the Proxmox API information.

For the tested environment:

```text
API URL: https://10.100.0.2:8006
Username: root@pam
TLS Verification: disabled for the isolated test environment
```

Enter the Proxmox root password and select **Import**.

After import, verify that the Proxmox node appears in Manager.

!!! warning "TLS Verification"
    TLS verification was disabled only because the isolated test node used the default self-signed Proxmox certificate.

    TLS verification should remain enabled when the Proxmox API has a trusted certificate.

### 8. Stage Additional OCI Images

Additional workload images can be transferred using the same staging process.

For example, the Debian base image used by the built-in Debian 13 template can be downloaded on the Internet-connected machine:

```bash
skopeo copy \
  docker://ghcr.io/mieweb/opensource-server/base:latest \
  oci-archive:base_latest.tar
```

Transfer it to Proxmox:

```bash
scp base_latest.tar \
  root@10.100.0.2:/var/lib/vz/template/cache/
```

Verify it:

```bash
pvesm list local --content vztmpl
```

The transferred OCI archive was successfully usable directly by Proxmox during testing.

!!! todo "Manager Workload Creation from Local Images"
    Manager's built-in workload flow currently attempts to contact GHCR for image metadata before checking for a locally available OCI image.

    As a result, selecting a built-in template such as Debian 13 can time out in a fully air-gapped environment even when the OCI archive has already been transferred to Proxmox.

    Support for using locally cached OCI images without registry access is tracked in [#454](https://github.com/mieweb/opensource-server/issues/454).


## Installation Steps

### 1. Pull the OCI Image

Using the Proxmox Web UI or CLI:

```bash
skopeo copy docker://ghcr.io/mieweb/opensource-server/manager:latest oci-archive:/var/lib/vz/template/cache/manager_latest.tar
```

### 2. Create the Management Container

In the Proxmox Web UI or CLI:

```bash
pct create 100 local:vztmpl/manager_latest.tar --cores=4 --features=nesting=1 --hostname=manager --memory=8192 --net0=name=eth0,bridge=vmbr0,gw=10.0.0.1,ip=10.0.0.3/16 --onboot=1 --ostype=debian --rootfs=local:50
```

!!! warning "Static IP Required"
    The management container must have a static IP. It runs a DNSMasq instance to manage DHCP within the network.

### 3. Configure Network Access

At your firewall, create the following port-forwards:

| Port | Protocol | Destination | Purpose |
|---|---|---|---|
| 8006 | tcp | Proxmox Server | Web UI access to the Proxmox server. |
| 22 | tcp | Proxmox Server | SSH access to the Proxmox server. |
| 80 | tcp | Manager Container | HTTP -> HTTPS redirect served by the Manager. |
| 443 | tcp | Manager Container | HTTPS load balancer service provided by the Manager. |
| 443 | udp | Manager Container | HTTP/3.0 QUIC load balancer service provided by the Manager. |
| 2000-2999 | tcp and udp | Manager Container | Layer-4 load balancing service provided by the Manager. |

### 4. Start the Container

In the Proxmox Web UI or CLI:

```bash
pct start 100
```

### 5. Initial Account Setup

1. Navigate to `https://example.org:443`.
2. Your web browser will warn about a self-signed certificate. Accept and bypass the warning. If your domain is in HSTS preload lists, you may need to use the IP address rather than the hostname until certificates are configured in a later step.
3. Select the "Register" link and create your account.

!!! warning "First Account"
    The **first account registered** is automatically approved with full admin privileges. Register the intended administrator account first.

### 6. Configure the First Site

Further reading: [Sites](core-concepts/sites.md).

1. Select "New Site".
2. Fill out the information:
    1. **Site Name**: `First Site`
    2. **Internal Domain**: `internal.example.org`
    3. **DHCP Range**: `10.0.1.1,10.0.254.254`
    4. **Subnet Mask**: `255.255.0.0`
    5. **Gateway**: `10.0.0.1`
    6. **DNS Forwarders**: `8.8.8.8,1.1.1.1`
    7. **External IP**: `your.ext.ernal.ip`
3. Select "Create Site".

### 7. Import Proxmox Nodes

Further reading: [Nodes](core-concepts/nodes.md).

1. Select "Import Nodes".
2. Fill in the information:
    1. **API URL**: `https://example.org:8006`
    2. **Username**: `root@pam`
    3. **Password**: your Proxmox root password
    4. **TLS Verification**: Enable
3. Select "Import".

### 8. Configure an External Domain

Further reading: [External Domains](core-concepts/external-domains.md).

1. Select "New External Domain".
2. Fill in the information:
    1. **Domain Name**: `example.org`
    2. **Default Site**: `First Site`
    3. **ACME Email** and **ACME Directory** are currently unused.
    4. **Cloudflare API Email** and **Key** are optional unless you are planning to use Cross-Site DNS.
    5. **oauth2-proxy URL**: optional — the address of an oauth2-proxy process (e.g. `http://127.0.0.1:4180`) if you want to require authentication for services on this domain (see [Authentication](core-concepts/external-domains.md#authentication)).
3. Select "Create External Domain".
4. Refer to [SSL Certificate Provisioning](core-concepts/external-domains.md#ssl-certificate-provisioning) to configure an HTTPS certificate.

### 9. Finalize the Manager Domain

1. On the Manager container, select "Edit".
2. Expand the "Services" menu.
3. Select "Add Service".
4. Fill in the information:
    1. **Type**: HTTP
    2. **Internal Port**: `3000`
    3. **External Hostname**: `manager`
    4. **External Domain**: `example.org`
    5. **Require Auth**: false
5. Select "Update Container".

!!! warning
    After this configuration propagates to the load balancer, you'll no longer be able to access the manager on any other hostname. The bare domain `example.org` will show the documentation and the manager will only be accessible on `manager.example.org`.
