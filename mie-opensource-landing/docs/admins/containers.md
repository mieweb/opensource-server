---
sidebar_position: 7
---

# Containers

Containers are Linux containers (LXC) that run on Proxmox nodes within your site. This section provides an administrative overview of container management.

## Container Overview

From an administrator's perspective, containers are:
- Lightweight virtualized environments running on Proxmox nodes
- Assigned IP addresses from the site's DHCP range
- Accessible via the built-in LDAP authentication system
- Exposed to the internet via external domains (optional)

## User Documentation

Most container operations are performed by end users through the web interface or command line.

### Creating Containers

For detailed guides on creating and managing containers, see the User Documentation:

- **[Web GUI Guide →](/docs/users/creating-containers/web-gui)**: Step-by-step container creation via web interface
- **[Command Line Guide →](/docs/users/creating-containers/command-line)**: Creating containers via API with curl

## Administrative Tasks

As an administrator, you'll manage containers at a higher level:

### Container Lifecycle

- **Creation**: Users create containers, which are assigned IPs and configured automatically
- **Running**: Containers run on assigned nodes with allocated resources
- **Monitoring**: Track container resource usage and health
- **Deletion**: Users or admins can delete containers to free resources

### Resource Management

Containers consume resources from their host node:
- **CPU**: Virtual cores allocated to the container
- **Memory**: RAM assigned from the node's available memory
- **Storage**: Disk space from the node's storage pools
- **Network**: IP addresses from the site's DHCP range

:::tip Resource Monitoring
Use the Proxmox web interface to monitor node resource usage and identify which containers are consuming the most resources.
:::

### Network Management

Each container receives:
- **IP Address**: Automatically assigned from the site's DHCP range
- **DNS Name**: `container-name.INTERNAL_DOMAIN`
- **Gateway**: Site's configured gateway
- **DNS Servers**: Site's configured DNS forwarders

### LDAP Authentication

The built-in LDAP server provides authentication to all containers:
- Users in the **ldapusers** group can SSH into any container
- Credentials are synchronized automatically
- Group memberships are reflected in container access

## Container States

Containers can be in various states:

| State | Description | User Access |
|-------|-------------|-------------|
| **Running** | Container is active and accessible | Full access via SSH/web |
| **Stopped** | Container is stopped but not deleted | No access |
| **Creating** | Container is being provisioned | No access yet |
| **Failed** | Creation or startup failed | No access |

## Troubleshooting Containers

### Container Won't Start

Common causes:
- Insufficient resources on the host node
- Corrupted container filesystem
- Network configuration issues
- Storage pool problems

**Check Proxmox logs:**
```bash
# On the Proxmox node
pct list  # List all containers
journalctl -u pve-container@CTID.service  # Check container logs
```

### User Can't Access Container

Verify:
- User status is **Active** (not Pending or Suspended)
- User is member of **ldapusers** group
- LDAP service is running on the management container
- Container is running and network is configured correctly

**Test LDAP authentication:**
```bash
# From the management container
ldapsearch -x -H ldap://localhost -b "dc=cluster,dc=internal"
```

### Container Has No Network Connectivity

Check:
- Container has an IP address: `pct config CTID`
- IP is within the site's DHCP range
- Gateway is reachable from the container
- DNS servers are configured correctly

**Test from within the container:**
```bash
# SSH into the container
ip addr  # Check IP address
ip route  # Check gateway
ping GATEWAY_IP  # Test gateway connectivity
ping 8.8.8.8  # Test internet connectivity
```

### Container Using Too Many Resources

To limit container resources:

1. Open the Proxmox web interface
2. Navigate to the container
3. Go to **Resources** tab
4. Adjust limits:
   - CPU Cores
   - CPU Limit
   - Memory
   - Swap

Changes typically require restarting the container.

## Service Exposure

Users can expose HTTP services from containers using external domains:

- Services are automatically configured with SSL/TLS certificates
- Reverse proxy routes traffic from external domains to container services
- DNS records are created automatically in Cloudflare

See [External Domains](external-domains) for configuration details.

## Backup and Recovery

:::note Backup Strategies
Container backup functionality depends on your Proxmox configuration. Refer to Proxmox documentation for setting up automated backups using:
- Proxmox Backup Server
- vzdump (built-in backup tool)
- Storage replication
:::

### Manual Backup

To manually backup a container:

```bash
# On the Proxmox node
vzdump CTID --compress zstd --mode snapshot --dumpdir /path/to/backup
```

### Restoring a Container

```bash
# On the Proxmox node
pct restore CTID /path/to/backup/vzdump-lxc-CTID-*.tar.zst
```

## Security Considerations

### Container Isolation

- Containers share the host kernel but are isolated from each other
- Use LXC security features (AppArmor, seccomp) for additional isolation
- Privileged containers should be avoided unless absolutely necessary

### Access Control

- Review user group memberships regularly
- Audit LDAP access logs for unauthorized attempts
- Suspend users immediately upon termination or security concerns

### Network Security

- Containers within a site can communicate with each other
- Use Proxmox firewall rules to restrict inter-container traffic if needed
- External services are exposed only when explicitly configured

## Performance Optimization

### Node Selection

Distribute containers across nodes based on:
- Current resource utilization
- Workload characteristics (CPU-intensive vs. I/O-intensive)
- Network proximity requirements

### Resource Allocation

- Allocate CPU and memory based on actual usage patterns
- Use memory limits to prevent runaway processes
- Monitor and adjust allocations over time

### Storage Performance

- Use faster storage (SSD/NVMe) for I/O-intensive containers
- Consider separate storage pools for different workload types
- Enable compression on storage to save space (if CPU allows)

## Next Steps

For more detailed container management:

- Review [User Documentation](/docs/users/creating-containers/web-gui) for creation workflows
- Set up monitoring for container health and resource usage
- Configure automated backups in Proxmox
- Review Proxmox documentation for advanced LXC features
