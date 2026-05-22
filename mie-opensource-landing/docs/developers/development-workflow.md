
# Development Workflow

## Prerequisites

- **Node.js 18+**, **Git**, and **Docker** for PostgreSQL
- **Proxmox VE 13+** instance for testing

## Local Setup

### With Docker Compose (Recommended)

```bash
git clone https://github.com/mieweb/opensource-server
cd opensource-server/create-a-container
cp example.env .env
# Edit .env with your Proxmox/DB settings
```

#### Example local PostgreSQL configuration

After copying `example.env` to `.env`, set the PostgreSQL variables for local development. The values below are examples for a local Docker setup:

```env
DATABASE_DIALECT=postgres

POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DATABASE=opensource_server
```

When using PostgreSQL, the SQLite and MySQL/MariaDB variables can remain blank.

Then start PostgreSQL and run the application:

```bash
docker compose up -d # Start PostgreSQL
npm install
npm run db:migrate
npm run dev
```

#### Troubleshooting

On Windows, if Docker Compose fails with an error similar to:

```text
POSTGRES_PASSWORD is missing a value
```

make sure `POSTGRES_PASSWORD` is set in `.env`.

If Docker Compose fails with an error similar to:

```text
open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified
```

make sure Docker Desktop is running, then verify Docker is available:

```bash
docker ps
```

After Docker Desktop is running, retry:

```bash
docker compose up -d
```

### Without Docker

Requires a running PostgreSQL instance.

```bash
git clone https://github.com/mieweb/opensource-server
cd opensource-server/create-a-container
cp example.env .env   # Edit with your PostgreSQL connection settings
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

