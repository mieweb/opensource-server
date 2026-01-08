---
sidebar_position: 6
---

# Nodes

Nodes represent individual Proxmox VE servers within a site. Each node can host multiple containers and must be registered with the cluster management system before use.

## What is a Node?

A node is a physical or virtual server running Proxmox VE that:
- Hosts Linux containers (LXC)
- Provides compute, memory, and storage resources
- Connects to the cluster management system via the Proxmox API
- Participates in the site's network infrastructure

Multiple nodes within a site form a Proxmox cluster, enabling high availability and resource distribution.

## Node Properties

Each node requires the following configuration:

- **Name**: The node name as it appears in the Proxmox cluster (must match exactly)
- **IP Address**: Used for internal DNS resolution
- **API URL**: The Proxmox API endpoint (e.g., `https://192.168.1.10:8006/api2/json`)
- **Authentication**: Either username/password or API token
  - **Username**: Typically `root@pam` for full access
  - **Password**: The user's password
  - **Token ID**: Alternative to username (e.g., `root@pam!mytoken`)
  - **Token Secret**: The token's secret value
- **TLS Verification**: Enable or disable certificate validation (optional)

## Adding Nodes

There are two methods for adding nodes to a site:

### Method 1: Import Nodes (Recommended)

The Import Nodes function automatically discovers all nodes in a Proxmox cluster:

1. Navigate to **Nodes** in the administration interface
2. Select your site
3. Click **Import Nodes**
4. Enter the connection details:
   - **API URL**: Any node in the cluster (e.g., `https://192.168.1.10:8006/api2/json`)
   - **Username**: `root@pam` (recommended)
   - **Password**: The root password
   - **Disable TLS Verification**: Check if using self-signed certificates

5. Click **Import**

The system will:
- Connect to the Proxmox cluster
- Discover all nodes automatically
- Import each node with correct names and IP addresses
- Verify API connectivity

:::tip Cluster Discovery
Import Nodes only needs credentials for one node. It will automatically discover and import all other nodes in the same Proxmox cluster.
:::

### Method 2: Manual Node Creation

For individual nodes or custom configurations:

1. Navigate to **Nodes** in the administration interface
2. Select your site
3. Click **Create New Node**
4. Fill in all required fields:
   - **Name**: Must exactly match the node name in Proxmox
   - **IP Address**: The node's network IP
   - **API URL**: `https://NODE_IP:8006/api2/json`
   - **Username**: `root@pam`
   - **Password**: The root password

5. Click **Save**

:::important Name Matching
The node name must **exactly match** the hostname shown in the Proxmox web interface. Mismatches will cause API communication failures.
:::

## Authentication Methods

### Username & Password

The traditional authentication method:

- **Pros**: Simple to configure, no token management
- **Cons**: Less secure, password changes require updating configuration
- **Recommended for**: Initial setup, testing

**Example:**
```
Username: root@pam
Password: your-root-password
```

### API Token (Recommended for Production)

A more secure alternative using Proxmox API tokens:

- **Pros**: More secure, can be revoked independently, fine-grained permissions
- **Cons**: Requires creating tokens in Proxmox first
- **Recommended for**: Production deployments

**Creating an API Token in Proxmox:**

1. Log in to Proxmox web interface
2. Navigate to **Datacenter** → **Permissions** → **API Tokens**
3. Click **Add** to create a new token
4. Configure the token:
   - **User**: `root@pam`
   - **Token ID**: A descriptive name (e.g., `cluster-mgmt`)
   - **Privilege Separation**: Uncheck (for full root access)
5. Save and copy the token secret (shown only once)

**Using the Token:**
```
Token ID: root@pam!cluster-mgmt
Token Secret: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

## TLS Certificate Verification

Proxmox uses self-signed certificates by default, which causes TLS verification to fail.

### Options:

**Disable TLS Verification** (Easiest)
- Check the "Disable TLS Verification" option when adding nodes
- ⚠️ Less secure (vulnerable to MITM attacks)
- ✅ Works immediately with self-signed certificates
- Recommended for: Isolated networks, internal deployments

**Install Valid Certificates** (Most Secure)
- Configure Proxmox to use certificates from a trusted CA
- Leave TLS verification enabled
- ✅ Maximum security
- Recommended for: Production, internet-facing deployments

:::tip Development vs Production
For isolated development clusters, disabling TLS verification is acceptable. For production environments exposed to untrusted networks, install valid certificates.
:::

## Verifying Node Configuration

After adding a node, verify it's working correctly:

1. Check the node status in the **Nodes** list
2. Verify the green checkmark or "Online" indicator appears
3. Test creating a container on the node

If the node shows as offline or unreachable:
- Verify the API URL is correct
- Check network connectivity from the management container
- Verify authentication credentials
- Review system logs for detailed error messages

## Node Management

### Updating Node Configuration

To modify a node's settings:

1. Navigate to the node's detail page
2. Update the necessary fields
3. Save changes
4. The system will test connectivity with the new configuration

### Removing Nodes

To remove a node from management:

1. Ensure no active containers are running on the node
2. Navigate to the node's detail page
3. Click **Delete** or **Remove**
4. Confirm the action

:::warning Container Dependencies
You cannot remove a node that has active containers. Migrate or delete containers first.
:::

## Multi-Node Considerations

### Load Distribution

The cluster management system can distribute containers across nodes based on:
- Available resources (CPU, memory, storage)
- Node health and availability
- Administrator preferences

### High Availability

Proxmox supports HA clustering features:
- Live migration of containers between nodes
- Automatic failover if a node fails
- Shared storage for container data

:::note HA Configuration
High availability features are configured in Proxmox itself, not in the cluster management system. Refer to Proxmox documentation for HA setup.
:::

## Troubleshooting

### Node Shows as Offline

**Check network connectivity:**
```bash
# From the management container
ping NODE_IP
curl -k https://NODE_IP:8006/api2/json
```

**Verify Proxmox API is running:**
```bash
# On the Proxmox node
systemctl status pveproxy
```

**Common issues:**
- Firewall blocking port 8006
- Proxmox API service not running
- Incorrect IP address or API URL
- Network routing issues

### Authentication Failures

**Check credentials:**
- Verify username/password or token/secret are correct
- Ensure the user has sufficient permissions
- Check if the API token hasn't been deleted or revoked

**Test authentication manually:**
```bash
curl -k -u "root@pam:PASSWORD" \
  https://NODE_IP:8006/api2/json/nodes
```

### Name Mismatch Errors

If you see "node name doesn't match" errors:

1. Check the node name in Proxmox: `hostname`
2. Update the node name in cluster management to match exactly
3. Node names are case-sensitive

### TLS Verification Errors

If seeing SSL certificate errors:
- Enable "Disable TLS Verification" option
- Or install valid certificates on Proxmox nodes
- Ensure the certificate hostname matches the API URL

## Next Steps

After adding nodes to your site:

1. **[Containers](containers)**: Learn about container deployment
2. Review the [User Documentation](/docs/users/creating-containers/web-gui) for creating containers
3. Set up monitoring and maintenance procedures
