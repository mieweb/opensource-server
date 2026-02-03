---
sidebar_position: 5
---

# Core Technologies

The MIE Opensource Proxmox Cluster is built on several key open-source technologies. This page provides links to external documentation for the core components.

## Backend Framework

### Express.js

**Express** is a minimal and flexible Node.js web application framework that provides the foundation for our API server.

- **Official Documentation**: [expressjs.com](https://expressjs.com/)
- **Getting Started**: [Express Guide](https://expressjs.com/en/guide/routing.html)
- **API Reference**: [Express API](https://expressjs.com/en/4x/api.html)

**Used For:**
- REST API endpoints
- Request routing and middleware
- Session management
- Server-side rendering

### Sequelize ORM

**Sequelize** is a promise-based Node.js ORM for Postgres, MySQL, MariaDB, SQLite, and more.

- **Official Documentation**: [sequelize.org](https://sequelize.org/)
- **Models Guide**: [Sequelize Models](https://sequelize.org/docs/v6/core-concepts/model-basics/)
- **Migrations**: [Sequelize Migrations](https://sequelize.org/docs/v6/other-topics/migrations/)
- **Querying**: [Sequelize Querying](https://sequelize.org/docs/v6/core-concepts/model-querying-basics/)

**Used For:**
- Database abstraction layer
- Schema migrations
- Model definitions
- Query building

## Frontend Templating

### EJS (Embedded JavaScript)

**EJS** is a simple templating language that lets you generate HTML markup with plain JavaScript.

- **Official Documentation**: [ejs.co](https://ejs.co/)
- **Syntax Reference**: [EJS Tags](https://ejs.co/#docs)
- **GitHub Repository**: [github.com/mde/ejs](https://github.com/mde/ejs)

**Used For:**
- Server-side rendering of HTML pages
- Dynamic content generation
- User interface templates
- Admin panel views

## Infrastructure

### Proxmox VE API

**Proxmox Virtual Environment** provides a RESTful API for managing virtual machines and containers.

- **API Documentation**: [pve.proxmox.com/pve-docs/api-viewer](https://pve.proxmox.com/pve-docs/api-viewer/)
- **API Guide**: [Proxmox VE API](https://pve.proxmox.com/wiki/Proxmox_VE_API)
- **Authentication**: [API Tokens](https://pve.proxmox.com/wiki/User_Management#pveum_tokens)

**Used For:**
- Container (LXC) creation and management
- Node information retrieval
- Resource allocation
- Cluster status monitoring

### LDAP Gateway

**LDAPServer** is a custom Node.js-based LDAP server that integrates with our database for authentication.

- **GitHub Repository**: [github.com/mieweb/LDAPServer](https://github.com/mieweb/LDAPServer)
- **SSSD Documentation**: [sssd.io/docs](https://sssd.io/docs/)

**Used For:**
- Centralized authentication for all containers
- User credential management
- Group membership resolution
- PAM/NSS integration via SSSD

## Supporting Libraries

### DNSMasq

**DNSMasq** provides network infrastructure services including DHCP and DNS.

- **Official Documentation**: [thekelleys.org.uk/dnsmasq/doc.html](http://www.thekelleys.org.uk/dnsmasq/doc.html)
- **Man Page**: [dnsmasq(8)](https://linux.die.net/man/8/dnsmasq)

**Used For:**
- DHCP server for container IP assignment
- DNS resolution for internal domain names
- DNS forwarding for external queries

### NGINX

**NGINX** is a high-performance HTTP server and reverse proxy.

- **Official Documentation**: [nginx.org/en/docs](https://nginx.org/en/docs/)
- **Reverse Proxy Guide**: [NGINX Reverse Proxy](https://docs.nginx.com/nginx/admin-guide/web-server/reverse-proxy/)
- **SSL/TLS**: [NGINX SSL Configuration](https://nginx.org/en/docs/http/configuring_https_servers.html)

**Used For:**
- HTTP/HTTPS reverse proxy
- TLS termination
- Layer 4 TCP proxying
- Load balancing

## Development Tools

### Node.js

**Node.js** is the JavaScript runtime that powers the entire application stack.

- **Official Documentation**: [nodejs.org/docs](https://nodejs.org/docs/)
- **API Reference**: [Node.js API](https://nodejs.org/api/)
- **Recommended Version**: 18+ LTS

### npm

**npm** is the package manager for Node.js.

- **Official Documentation**: [docs.npmjs.com](https://docs.npmjs.com/)
- **CLI Commands**: [npm CLI](https://docs.npmjs.com/cli/v10/commands)

### Docker & Docker Compose

**Docker** provides containerization for development and deployment, while **Docker Compose** orchestrates multi-container applications.

- **Docker Documentation**: [docs.docker.com](https://docs.docker.com/)
- **Docker Compose Documentation**: [docs.docker.com/compose](https://docs.docker.com/compose/)
- **Dockerfile Reference**: [Dockerfile Reference](https://docs.docker.com/reference/dockerfile/)

**Used For:**
- Building container images for deployment
- Local development environment (PostgreSQL via compose.yml)
- CI/CD pipeline image building
- Testing in isolated environments

## Related Resources

- [System Architecture](system-architecture): Understand how these technologies work together
- [Development Workflow](development-workflow): Set up your development environment
- [Contributing](contributing): Contribute to the project
- [GitHub Repository](https://github.com/mieweb/opensource-server): View the source code

## Version Requirements

| Technology | Minimum Version | Recommended |
|------------|----------------|-------------|
| Node.js | 18.x | 20.x LTS |
| Proxmox VE | 13.0 | Latest stable |
| PostgreSQL | 12.x | 15.x+ |
| MySQL | 8.0 | 8.0+ |
| NGINX | 1.18 | Latest stable |

## Additional Documentation

For implementation-specific details, refer to:
- Code comments in the repository
- README files in individual directories
- Migration files for database schema changes
- Environment variable documentation in `.env.example`
