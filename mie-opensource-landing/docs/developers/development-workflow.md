---
sidebar_position: 3
---

# Development Workflow

## Prerequisites

- **Node.js 18+**, **Git**, and optionally **Docker** for PostgreSQL
- **Proxmox VE 13+** instance for testing
- SQLite works out of the box; PostgreSQL/MySQL optional

## Local Setup

### With Docker Compose (Recommended)

```bash
git clone https://github.com/mieweb/opensource-server
cd opensource-server/create-a-container
cp example.env .env   # Edit with your Proxmox/DB settings
docker compose up -d   # Start PostgreSQL
npm install
npm run db:migrate
npm run dev
```

### Without Docker

```bash
git clone https://github.com/mieweb/opensource-server
cd opensource-server/create-a-container
cp example.env .env   # Edit settings (SQLite: no DB setup needed)
npm install
npm run db:migrate
npm run dev
```

## Key Directories

```
create-a-container/
├── models/          # Sequelize database models
├── routers/         # Express API route handlers
├── middlewares/     # Authentication & authorization
├── migrations/      # Database schema migrations
├── views/           # Server-rendered EJS templates
└── public/          # Static assets
```

## Database Changes

Always create migrations for schema changes. Test both up and down. Use transactions for multi-step migrations.

## Local Docker Image Build

```bash
docker build -t opensource-server:dev .
docker run -d --privileged --name opensource-test \
  -p 80:80 -p 443:443 -p 53:53/udp opensource-server:dev
```

Copies your local code (including uncommitted changes) — ideal for testing before pushing.

## CI/CD

GitHub Actions builds and pushes Docker images on every push. Tags: branch name, `latest` (main only). Workflow: `.github/workflows/docker-build-push.yml`.

## Debugging

```bash
DEBUG=* npm run dev          # Verbose output
node --inspect index.js      # Node inspector
DB_LOGGING=true npm run dev  # Sequelize query logging
```

