---
sidebar_position: 2
---

# System Architecture

## Overview

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

## Components

| Component | Role |
|-----------|------|
| **Proxmox VE 13+** | Hypervisor — manages LXC containers via REST API. [Nodes](/docs/admins/core-concepts/nodes) are registered Proxmox servers. |
| **DNSMasq** | DHCP + DNS. Auto-assigns IPs to containers, provides internal name resolution (`container.cluster.internal`). |
| **NGINX** | Reverse proxy — L7 (HTTP/HTTPS with auto TLS via ACME) and L4 (TCP port mapping). Config auto-generated from container services. |
| **LDAP Gateway** | Node.js LDAP server ([source](https://github.com/mieweb/LDAPServer)). Reads users/groups from the DB; containers authenticate via PAM/SSSD. |
| **Push Notification Service** | 2FA via push notifications ([source](https://github.com/mieweb/mieweb_auth_app)). Configured in [Settings](/docs/admins/settings). Used by LDAP gateway when `AUTH_BACKENDS` includes `notification`. |
| **Database** | SQLite (default), PostgreSQL, or MySQL via Sequelize ORM. Stores users, groups, sites, nodes, containers, and service config. |

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

