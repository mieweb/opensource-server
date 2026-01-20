---
sidebar_position: 2
---

# System Architecture

The MIE Opensource Proxmox Cluster is built on a carefully integrated stack of open-source technologies that work together to provide automated container hosting and management.

## System Architecture

```mermaid
graph TB
    subgraph "Management Layer"
        WebUI[Web UI<br/>EJS Templates]
        API[Node.js API Server]
        DB[(Database<br/>SQLite/Postgres/MySQL)]
        LDAP[LDAP Gateway<br/>NodeJS]
    end
    
    subgraph "Network Services"
        DNS[DNSMasq<br/>DHCP + DNS]
        NGINX[NGINX<br/>Reverse Proxy]
    end
    
    subgraph "External Services"
        PushNotif[Push Notification Service<br/>2FA Authentication]
    end
    
    subgraph PVE[Proxmox Cluster]
        LXC[LXC Container]
    end
    
    WebUI --> API
    API --> DB
    API --> PVE
    API --> DNS
    API --> NGINX
    API --> PushNotif
    LDAP --> DB
    LDAP --> PushNotif
    LXC -.-> LDAP
    DNS --> LXC
    NGINX --> LXC
    
    classDef management fill:#e1f5ff,stroke:#01579b
    classDef network fill:#f3e5f5,stroke:#4a148c
    classDef compute fill:#e8f5e9,stroke:#1b5e20
    classDef external fill:#fff3e0,stroke:#e65100
    
    class WebUI,API,DB,LDAP management
    class DNS,NGINX network
    class LXC compute
    class PushNotif external
```

## Core Components

### Proxmox VE 13+

**Proxmox Virtual Environment** serves as the hypervisor layer, providing virtualization capabilities through KVM and LXC. Version 13 or higher is required for OCI image support.

**Key Features:**
- LXC (Linux Containers) management for lightweight compute nodes
- API-driven automation for container lifecycle management
- Web interface for manual container administration
- Clustering support for high availability

**Integration:**
- The management API communicates with Proxmox via REST API
- [Nodes](/docs/admins/nodes) are registered Proxmox servers in the cluster
- [Containers](/docs/admins/containers) are LXC instances managed by Proxmox

### DNSMasq

**DNSMasq** provides both DHCP and DNS services for the cluster network.

**DHCP Functionality:**
- Automatically assigns IP addresses to new containers from the configured range
- Containers and [nodes](/docs/admins/nodes) reserve their assigned IPs for stability
- IP reservations persist across container restarts and lifecycle events

**DNS Functionality:**
- Provides name resolution for containers within the cluster
- Internal domain structure: `container-name.cluster.internal`
- Forwards external DNS queries to configured upstream servers

**Integration:**
- Management API updates DNSMasq configuration when containers are created/destroyed
- IP assignments are tracked in the backend database
- DNS records are automatically created for all cluster resources

### NGINX

**NGINX** handles all ingress traffic to containers, supporting both HTTP/HTTPS and TCP protocols.

**Layer 7 HTTP Proxying:**
- Terminates TLS for HTTPS traffic
- Routes requests based on hostname/subdomain
- Automatically obtains and renews SSL certificates for [external domains](/docs/admins/external-domains)
- Supports multiple domains and subdomains per container

**Layer 4 TCP Proxying:**
- Proxies non-HTTP protocols (SSH, databases, custom services)
- Port mapping from external ports to container services
- Transparent connection handling

**Integration:**
- Configuration is automatically generated based on container services
- Certificate management integrated with ACME providers (Let's Encrypt)
- Dynamic backend resolution using DNSMasq for container IPs

### LDAP Gateway

The **LDAP Gateway** is a Node.js-based LDAP server that provides centralized authentication for all cluster services.

**Repository:** [github.com/mieweb/LDAPServer](https://github.com/mieweb/LDAPServer)

**Functionality:**
- Serves LDAP authentication requests from containers
- Retrieves user and group data from the backend database
- Provides unified login credentials across all cluster resources
- Integrates with standard PAM/NSS on Linux containers

**User Management:**
- Users authenticate with cluster-wide credentials
- Group memberships determine access permissions
- Password changes propagate immediately to all services

**Integration:**
- Containers configure PAM to authenticate against the LDAP server
- All users in the `ldapusers` group can SSH into containers
- User data synchronized from the backend database

### Push Notification Service

The **Push Notification Service** provides two-factor authentication (2FA) via push notifications to users' mobile devices.

**Repository:** [github.com/mieweb/mieweb_auth_app](https://github.com/mieweb/mieweb_auth_app)

**Functionality:**
- Sends push notifications to users' registered devices during login
- Allows users to approve or reject login attempts
- Handles device registration and management
- Provides timeout mechanism for unanswered notifications

**Authentication Flow:**
- API server sends notification request with username
- Service delivers push notification to user's device
- User approves/rejects the login attempt on their device
- Service returns the user's decision to the API server
- API server grants or denies access based on the response

**Integration:**
- Configurable via the [Settings page](/docs/admins/settings) (admin only)
- LDAP gateway uses the notification service when `AUTH_BACKENDS` includes `notification`
- API server validates credentials before sending push notifications
- Notification URL configured in database settings and propagated to `ldap.conf`

**Configuration:**
- Push notification URL stored in `Settings` table
- Feature enabled/disabled via admin interface
- LDAP containers automatically updated with notification URL
- No additional container configuration required

### Backend Database

The **backend database** stores all cluster state and configuration.

**Supported Databases:**
- **SQLite** (default): Simple file-based database, no additional setup required
- **PostgreSQL**: Production-grade relational database for larger deployments
- **MySQL**: Alternative production database option

**ORM Abstraction:**
- Uses Sequelize ORM for database abstraction
- Allows switching between database backends without code changes
- Handles migrations for schema updates

**Stored Data:**
- User accounts and authentication credentials
- Group definitions and memberships
- Site configurations (network settings, domains)
- Node registrations (Proxmox API endpoints)
- Container metadata (IPs, ports, services)
- Service exposure rules and SSL certificate info

## Data Flow

### Container Creation

```mermaid
sequenceDiagram
    participant User
    participant API
    participant Proxmox
    participant LXC
    participant DNSMasq
    participant DB
    participant NGINX
    
    User->>API: Create Container Request
    API->>Proxmox: Create LXC via API
    Proxmox->>LXC: Create
    LXC->>DNSMasq: Retrieve IP via DHCP
    DNSMasq-->>LXC: IP assigned
    API->>DNSMasq: Retrieve IP for new LXC
    DNSMasq-->>API: LXC IP address
    API->>DB: Store LXC + IP information
    API-->>User: Container ready
    NGINX->>API: Retrieve updated config
    API-->>NGINX: Updated routing config
```

### User Authentication

```mermaid
sequenceDiagram
    participant User
    participant Container
    participant LDAP
    participant DB
    participant PushNotif as Push Notification<br/>Service
    
    User->>Container: SSH login attempt
    Container->>LDAP: LDAP bind request
    LDAP->>DB: Verify credentials
    DB-->>LDAP: Password validated
    
    alt 2FA Enabled
        LDAP->>PushNotif: Send notification (username)
        PushNotif->>User: Push notification to device
        User->>PushNotif: Approve/Reject
        PushNotif-->>LDAP: User decision
        alt Approved
            LDAP-->>Container: Authentication success
            Container-->>User: Login granted
        else Rejected or Timeout
            LDAP-->>Container: Authentication failed
            Container-->>User: Access denied
        end
    else 2FA Disabled
        LDAP-->>Container: Authentication success
        Container-->>User: Login granted
    end
```

### HTTP Service Exposure

```mermaid
sequenceDiagram
    participant Client
    participant NGINX
    participant ACME
    participant DNSMasq
    participant Container
    
    Note over NGINX: Initial setup
    NGINX->>ACME: Request certificate
    ACME-->>NGINX: Certificate issued
    
    Note over Client: User request
    Client->>NGINX: HTTPS request (app.example.com)
    NGINX->>DNSMasq: Resolve container IP
    DNSMasq-->>NGINX: Container IP address
    NGINX->>Container: Forward request
    Container-->>NGINX: Response
    NGINX-->>Client: HTTPS response
```

## Next Steps

For more information:

- [Development Workflow](development-workflow): Set up your development environment
- [Contributing](contributing): Learn how to contribute to the project
- [Administrator Documentation](/docs/admins/): Configure and manage the cluster
- [User Documentation](/docs/users/creating-containers/web-gui): Create and deploy containers
- [GitHub Repository](https://github.com/mieweb/opensource-server): Source code and issues
- [GitHub Repository](https://github.com/mieweb/opensource-server): Source code and issues

