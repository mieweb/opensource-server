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
