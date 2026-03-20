# Create-a-Container

Web application for managing LXC containers on Proxmox VE with a user-friendly interface and REST API.

## Quick Start (Local Development)

```bash
cd create-a-container
npm install
npx sequelize-cli db:migrate
npx sequelize-cli db:seed:all
node server.js
```

Open **http://localhost:3000** — the login page shows "No users exist yet."

### First User = Admin

1. Click **Register** and create an account
2. Log in immediately (first user is auto-approved as admin)
3. Subsequent users require admin approval or email invite

### Reset Database

```bash
rm data/database.sqlite
npx sequelize-cli db:migrate
npx sequelize-cli db:seed:all
```

## Features

- **Container Management** — Create, list, and track LXC containers
- **Docker/OCI Support** — Deploy from Docker Hub, GHCR, or any OCI registry
- **Service Registry** — Track HTTP/TCP/UDP services per container
- **Dynamic Nginx Config** — Auto-generate reverse proxy configurations
- **User Management** — Self-service registration with admin approval
- **Push Notification 2FA** — Optional two-factor authentication

## Configuration

SQLite is used by default for local development. For production, create a `.env` file:

```bash
# PostgreSQL (production)
DATABASE_DIALECT=postgres
POSTGRES_HOST=localhost
POSTGRES_USER=cluster_manager
POSTGRES_PASSWORD=secure_password
POSTGRES_DATABASE=cluster_manager

# Session (required for production)
SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

NODE_ENV=production
```

## Production Deployment

### Systemd Service

```bash
sudo cp systemd/create-a-container.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now create-a-container
```

### Job Runner (Background Tasks)

The job runner processes container creation tasks asynchronously:

```bash
# Development
npm run job-runner

# Production
sudo cp systemd/job-runner.service /etc/systemd/system/
sudo systemctl enable --now job-runner
```

## Data Model

```mermaid
erDiagram
    Site ||--o{ Node : contains
    Node ||--o{ Container : hosts
    Container ||--o{ Service : exposes
    
    Site { int id PK; string name; string internalDomain }
    Node { int id PK; string name UK; string apiUrl; int siteId FK }
    Container { int id PK; string hostname UK; string status; int nodeId FK }
    Service { int id PK; string type; int internalPort; int containerId FK }
```

## API Reference

See [openapi.yaml](openapi.yaml) for the complete API specification.

### Key Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/login` | Login page |
| `POST` | `/login` | Authenticate user |
| `GET` | `/sites` | List all sites |
| `GET` | `/sites/:id/nodes` | List nodes in a site |
| `GET` | `/sites/:id/containers` | List containers in a site |
| `POST` | `/containers` | Create container (async job) |
| `DELETE` | `/containers/:id` | Delete container |
| `GET` | `/sites/:siteId/nginx` | Generate nginx config |

## Development

### Database Migrations

```bash
# Create migration
npx sequelize-cli migration:generate --name description-here

# Run migrations
npx sequelize-cli db:migrate

# Undo last migration
npx sequelize-cli db:migrate:undo
```

### Project Structure

```
create-a-container/
├── server.js           # Express application
├── config/             # Database configuration
├── models/             # Sequelize models
├── migrations/         # Database migrations
├── seeders/            # Initial data
├── routers/            # Route handlers
├── views/              # EJS templates
├── public/             # Static assets
└── systemd/            # Service files
```
