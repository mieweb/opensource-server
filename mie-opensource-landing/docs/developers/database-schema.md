---
sidebar_position: 6
---

# Database Schema

The cluster management system uses Sequelize ORM for database abstraction, supporting SQLite (default), PostgreSQL, and MySQL.

## Entity Relationship Diagram

```mermaid
erDiagram
    Sites ||--o{ Nodes : contains
    Sites ||--o{ ExternalDomains : "default site"
    Nodes ||--o{ Containers : hosts
    Containers ||--o{ Services : exposes
    Containers }o--o| Jobs : "created by"
    Services ||--|| HTTPServices : "type: http"
    Services ||--|| TransportServices : "type: transport"
    Services ||--|| DnsServices : "type: dns"
    ExternalDomains ||--o{ HTTPServices : "used by"
    Jobs ||--o{ JobStatuses : tracks
    Users }o--o{ Groups : "member of"
    UserGroups }|--|| Users : joins
    UserGroups }|--|| Groups : joins
    PasswordResetTokens }o--|| Users : "for"
    InviteTokens ||--o| Users : "creates"

    Sites {
        int id PK
        string name
        string internalDomain
        string dhcpRange
        string subnetMask
        string gateway
        string dnsForwarders
        string externalIp "Public IP for DNS A records"
    }

    Nodes {
        int id PK
        string name UK
        string ipv4Address
        string apiUrl
        string apiTokenIdOrUsername
        string apiTokenSecretOrPassword
        boolean disableTlsVerification
        string imageStorage "default: local"
        string volumeStorage "default: local-lvm"
        int siteId FK
    }

    Containers {
        int id PK
        string hostname UK
        string username
        string status "pending,creating,running,failed"
        string template
        int creationJobId FK
        int nodeId FK
        int containerId
        string macAddress UK
        string ipv4Address UK
        string aiContainer
    }

    Services {
        int id PK
        int containerId FK
        enum type "http,transport,dns"
        int containerPort
    }

    HTTPServices {
        int id PK
        int serviceId FK,UK
        string externalHostname
        int externalDomainId FK
    }

    TransportServices {
        int id PK
        int serviceId FK,UK
        enum protocol "tcp,udp"
        int externalPort UK
        boolean useTls
    }

    DnsServices {
        int id PK
        int serviceId FK,UK
        enum recordType "SRV"
        string serviceName
    }

    ExternalDomains {
        int id PK
        string domain
        string acmeEmail
        string acmeDirectory
        string cloudflareApiEmail
        string cloudflareApiKey
        int siteId FK "nullable, default site"
    }

    Jobs {
        int id PK
        string name
        string associatedResource
        enum status "pending,running,success,failure,cancelled"
    }

    JobStatuses {
        int id PK
        int jobId FK
        text message
    }

    Users {
        int uidNumber PK
        string username UK
        string cn "Common Name"
        string sn "Surname"
        string givenName
        string mail UK
        text sshPublicKey
        string userPassword
        string status "pending,active,suspended"
    }

    Groups {
        int gidNumber PK
        string cn UK "Group Name"
        boolean isAdministrator
    }

    UserGroups {
        int uidNumber PK,FK
        int gidNumber PK,FK
    }

    SessionSecrets {
        int id PK
        string secret UK
    }

    Settings {
        string key PK,UK
        string value
    }

    PasswordResetTokens {
        uuid id PK
        int uidNumber FK
        string token UK
        datetime expiresAt
        boolean used
    }

    InviteTokens {
        uuid id PK
        string email
        string token UK
        datetime expiresAt
        boolean used
    }
```

## Core Models

### Site
Top-level organizational unit. Has many Nodes. Has many ExternalDomains (as default site). `externalIp` is the public IP used as the target for Cloudflare DNS A records when cross-site HTTP services are created.

### Node
Proxmox VE server within a site. `name` must match Proxmox hostname (unique). `imageStorage` defaults to `'local'` (CT templates). `volumeStorage` defaults to `'local-lvm'` (container rootfs). Belongs to Site, has many Containers.

### Container
LXC container on a Proxmox node. Unique composite index on `(nodeId, containerId)`. `hostname`, `macAddress`, `ipv4Address` globally unique. Belongs to Node and optionally to a Job.

### Service (STI)
Base model with `type` discriminator (`http`, `transport`, `dns`). Belongs to Container.

- **HTTPService**: `(externalHostname, externalDomainId)` unique. Belongs to ExternalDomain.
- **TransportService**: `(protocol, externalPort)` unique. `findNextAvailablePort()` static method.
- **DnsService**: SRV records with `serviceName`.

### ExternalDomain
Manages public domains for HTTP service exposure. `siteId` is nullable — when set, indicates the "default site" whose DNS is assumed pre-configured (e.g., wildcard A record). Global resource available to all sites. Has many HTTPServices. Cloudflare credentials used for both ACME DNS-01 challenges and cross-site A record management.

## User Management Models

### User
LDAP-compatible user accounts. Passwords hashed with argon2. UIDs start at 2000 (`getNextUid()`). Only `active` users can authenticate. First registered user auto-added to `sysadmins`.

### Group
LDAP-compatible groups. Default groups: `ldapusers` (gid: 2000), `sysadmins` (gid: 2001).

### UserGroup
Join table. Composite primary key on `(uidNumber, gidNumber)`.

### PasswordResetToken
UUID-based tokens with 1-hour default expiry. Methods: `generateToken()`, `validateToken()`, `cleanup()`.

### InviteToken
UUID-based invite tokens with 24-hour default expiry. Email tied to token and locked during registration. Methods: `generateToken()`, `validateToken()`, `cleanup()`.

## Job Management

### Job
Tracks async operations (container creation, etc.). Statuses: `pending`, `running`, `success`, `failure`, `cancelled`.

### JobStatus
Progress messages for a Job.

## System

- **SessionSecret**: Stores express-session secrets
- **Setting**: Key-value pairs for system config. Methods: `get()`, `set()`, `getMultiple()`

## Database Abstraction

Implemented with **Sequelize ORM**: supports SQLite (default), PostgreSQL, MySQL. Includes migrations, field validation, hooks (password hashing, UID assignment), and declarative associations.

## Key Design Patterns

- **Service STI**: Base `Services` table with `type` discriminator; child tables (`HTTPServices`, `TransportServices`, `DnsServices`) extend via one-to-one relationships
- **LDAP compatibility**: User/Group models use LDAP naming (`uidNumber`, `gidNumber`, `cn`, `sn`, `givenName`)
- **Hierarchy**: Site → Nodes → Containers → Services (mirrors physical topology)
