# Create-a-Container (Manager)

The Manager web application for opensource-server: a Node.js + Express + Sequelize
app that manages LXC container creation, configuration, and lifecycle on Proxmox
VE, exposes a REST API, and generates the nginx/dnsmasq configuration consumed by
agents.

This README documents the component itself. For installing, operating, or
developing the wider system, start with the guides below.

| If you want to... | Read |
|---|---|
| Install and operate a production deployment | [Installation Guide](../mie-opensource-landing/docs/admins/installation.md) |
| Run the Manager locally to develop or contribute | [Development Workflow](../mie-opensource-landing/docs/developers/development-workflow.md) |
| Understand the system design | [System Architecture](../mie-opensource-landing/docs/developers/system-architecture.md) |

## Running it

### Development

```bash
make dev
```

That's all you need. `make dev` installs dependencies, runs database migrations
and dev seeders, builds the client, and starts the server, the job-runner, and
the client build watcher together. It uses SQLite and a dummy (mock) hypervisor,
so **no `.env`, PostgreSQL, or Proxmox cluster is required** — the Manager comes
up at <http://localhost:3000> and can "create" containers locally (simulated).

Pass `LOG_LEVEL=trace` to additionally log every SQL query:

```bash
make dev LOG_LEVEL=trace
```

For the full Docker-based stack (real reverse proxy, DNS, Proxmox VE), see the
[Development Workflow](../mie-opensource-landing/docs/developers/development-workflow.md).

### Production

The Manager is not installed by hand in production. It ships as:

- an **OCI image** (`images/manager`) — the supported deployment, used by the
  [Installation Guide](../mie-opensource-landing/docs/admins/installation.md); and
- distribution **packages** built from this directory with `make deb`, `make rpm`,
  or `make apk` (via [fpm](https://fpm.readthedocs.io/)), which install the app
  under `/opt/opensource-server/create-a-container` and register the
  `container-creator` and `job-runner` systemd services.

In both cases the app runs `server.js` (HTTP API + UI) and `job-runner.js`
(background worker). Database connection settings come from the environment (see
[Configuration](#configuration)); the manager image provisions PostgreSQL and
writes these to `/etc/default/container-creator` on first boot.

## Configuration

Configuration is read from environment variables (a local `.env` file is
supported in development). See [`example.env`](example.env) for the full list,
including the database dialect/connection settings and the optional OIDC
single-sign-on variables. Session secrets are generated and stored automatically
— there is no secret to configure.

Production uses PostgreSQL (`DATABASE_DIALECT=postgres`); `make dev` uses SQLite.

## Database migrations & seeders

Migrations are applied **automatically at server startup**. `server.js` calls the
runner in `utils/migrate.js`, which uses [umzug](https://github.com/sequelize/umzug)
to run every pending migration in `migrations/` before the HTTP server begins
listening. Only one process migrates at a time: the run is wrapped in an
engine-appropriate advisory lock (`pg_advisory_lock` on PostgreSQL, `GET_LOCK` on
MySQL; SQLite needs none). If a migration fails the process exits non-zero and
does not serve traffic.

`sequelize-cli` is a dev dependency used for authoring and ad-hoc management:

```bash
# Create a new migration
npx sequelize-cli migration:generate --name description-here

# Apply migrations + seeders manually
npm run db:migrate

# Undo the last migration
npx sequelize-cli db:migrate:undo
```

The `seeders/` directory is for **development/test data only** (e.g. the local
`make dev` site and dummy node). Data that must exist on every deployment lives in
`migrations/`, so it is applied automatically at startup.

## API

The REST API is versioned under `/api/v1` and documented by the OpenAPI spec in
[`openapi.v1.yaml`](openapi.v1.yaml), browsable via the built-in Swagger UI at
`/api` when the server is running.

## Layout

```
create-a-container/
├── server.js        # HTTP API + UI (Express)
├── job-runner.js    # Background job worker
├── client/          # React/Vite single-page app (built to client/dist)
├── config/          # Sequelize configuration
├── models/          # Sequelize models
├── migrations/      # Database migrations (applied at startup)
├── seeders/         # Dev/test data seeders
├── routers/         # API and template routers
├── middlewares/     # Express middleware
├── utils/           # Shared helpers (incl. the migration runner)
├── views/           # EJS templates (nginx/dnsmasq config generation)
├── contrib/         # systemd units, logrotate, packaging hooks
└── Makefile         # dev, build, and packaging targets
```

## License & support

See the main repository [LICENSE](../LICENSE). For issues, questions, or
contributions, see the [opensource-server](https://github.com/mieweb/opensource-server)
repository.
