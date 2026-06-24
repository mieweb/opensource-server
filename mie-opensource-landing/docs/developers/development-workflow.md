# Development Workflow

{{ contributor_warning }}

There are two ways to run the Manager locally:

- **`make dev`** — a lightweight, Proxmox-free workflow for iterating on the
  Manager web app itself (SQLite, runs on `localhost`). Start here for UI/API work.
- **Docker stack** — the full stack (Proxmox, Manager, docs, bootstrap) for
  exercising real container provisioning against a virtualized Proxmox.

## Run the Manager Locally (`make dev`)

Use this when you're working on the Manager web app and don't need a real
hypervisor. It runs `create-a-container` against SQLite and uses a **dummy
node** as a mock hypervisor so you can create containers without Proxmox.

```bash
make dev
```

This will:

1. Install dependencies. This also applies the bundled
   [`patch-package`](https://www.npmjs.com/package/patch-package) patches —
   notably a backport of [sequelize#17583](https://github.com/sequelize/sequelize/pull/17583)
   that fixes SQLite incorrectly adding a `UNIQUE` constraint to members of a
   composite index.
2. Run database migrations.
3. Seed a local dev environment (a `localhost` site, a `dummy` node, and a
   `localhost` external domain) — but only when the database is empty, so it
   never interferes with the Docker stack's bootstrap.
4. Build the React client.
5. Start the **server** and the **job-runner** together, serving at
   [http://localhost:3000](http://localhost:3000).

No configuration is required — the server's defaults are sufficient for
development: it uses SQLite (`data/database.sqlite`), generates a session
secret on first run, and enables the dev login when not running in production.

Environment variables can be passed on the command line, e.g. to log every SQL
query (verbose):

```bash
make dev LOG_LEVEL=trace
```

Log in via the dev login button (no Proxmox or external IdP required).

!!! note "How mock provisioning works"
    Creating a container still goes through the real code path:
    `POST /containers` → a `Job` row → the **job-runner** → `bin/create-container.js`
    → `node.api()`. For a dummy node, `node.api()` returns a `DummyApi` (instead
    of `ProxmoxApi`) that implements the same interface and simulates the
    Proxmox calls, so the container lands `running` with a placeholder
    VMID/MAC/IP. This is why `make dev` runs the job-runner alongside the server.

    The Docker registry digest lookup is **not** mocked, so resolving an image
    requires network access (the same as production).

!!! note "Don't mix node types in a site"
    Node selection is provider-agnostic and does not distinguish dummy from real
    nodes — it just picks the least-loaded node in the site. Keep dummy nodes in
    dev-only sites; don't add one to a site that has real Proxmox nodes. To
    exercise actual provisioning, use the Docker stack below.

## Full Stack with Docker

The entire stack — Proxmox, Manager, docs, and bootstrap — runs locally inside Docker.

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/)

### Start the Stack

From the repository root:

```bash
docker compose up -d
```

This brings up:

| Service | Purpose |
|---|---|
| `npm ci` job | Installs the Manager's Node.js dependencies in the mounted workspace |
| `client` | Installs the React client's dependencies and rebuilds its production bundle on file changes |
| `proxmox` | Virtualized Proxmox VE host |
| Manager container | The Manager application, running as a CT (`100`) inside the virtualized Proxmox |
| `zensical` | Rebuilds these docs on file changes |
| Bootstrap (one-shot) | Configures the Manager container to use the virtualized Proxmox |

### Manager Image Selection

By default the compose stack deploys `ghcr.io/mieweb/opensource-server/manager:latest`. Override the tag by setting `MANAGER_TAG` in your environment or in a `.env` file alongside `compose.yml`:

```bash
MANAGER_TAG=my-feature-branch docker compose up -d
```

The template download step checks your **local** Docker images first, so a locally-built `manager:<tag>` image is used without pulling from GHCR — handy for testing in-progress changes to the Manager image itself.

!!! note "Reusing a tag"
    The downloaded template tarball is persisted in the named `local` volume so subsequent `docker compose up` cycles start quickly. To pick up a new build of the same tag, either:

    - Delete the cached tar file from the `local` volume, or
    - Recreate the volume (e.g., `docker compose down -v`).

### Persistent State and Full Reset

Proxmox state is persisted across container creation and destruction in two
named volumes, so `docker compose down` followed by `docker compose up` keeps
everything and starts back up quickly without re-bootstrapping:

| Volume | Mount | Contents |
|---|---|---|
| `local` | `/var/lib/vz` | VM/CT disk images, volumes, and the cached Manager template |
| `proxmox` | `/var/lib/pve-cluster` | Proxmox cluster state (the configuration database) |

To wipe everything and start completely fresh, remove the named volumes:

```bash
docker compose down -v
```

This deletes the cached template tarball, all stored images/volumes, and the
cluster state, so the next `docker compose up` re-downloads the Manager template
and re-runs the bootstrap from scratch.

### Endpoints

| URL | Description |
|---|---|
| `https://localhost:8006` | Proxmox Web UI |
| `http://localhost` | Redirects to `https://localhost` |
| `https://localhost` | Documentation site |
| `https://manager.localhost` | Manager Web UI |

### Credentials and Shell Access

**Proxmox Web UI:** `root` / `root`

**Proxmox CLI:** Use the **Shell** option in the Web UI, or:

```bash
docker compose exec -it proxmox bash
```

**Manager container shell:**

```bash
docker compose exec -it proxmox pct enter 100
```

**Manager Postgres:**

```bash
docker compose exec -it proxmox pct exec 100 -- sudo -u postgres psql cluster_manager
```

### Live Reload

The local git repository is mounted **read-only** into `/opt/opensource-server` on the Manager container, so source changes on the host are visible immediately.

| Component | Reload behavior |
|---|---|
| Manager server | Auto-restarted by `nodemon` |
| Manager UI (React client) | Auto-rebuilt by the `client` service |
| Documentation | Auto-rebuilt by the `zensical` service |
| Job runner | Restart manually |
| Database migrations | Run manually in the proper server context (see below) |

#### Frontend Rebuilds

The Manager serves the compiled React app from `create-a-container/client/dist`; it does **not** run the Vite dev server. Because the repository is mounted **read-only** into the Manager container, Vite can't write build output from there. Instead, the dedicated `client` service mounts the repository **read-write** and runs `vite build --watch`, rebuilding `client/dist` on the host whenever the client source changes.

The Manager container's read-only bind mount still reflects those host changes, so the running server picks up the new bundle on the next request — just refresh your browser. No `nodemon` restart is required for client-only changes.

!!! note "First build on a fresh checkout"
    The `client` service performs an initial build before Proxmox starts serving (the `proxmox` service waits for it to become healthy), so a bundle always exists even on a clean checkout where `client/dist` isn't present yet.


#### Run Database Migrations

```bash
docker compose exec proxmox pct exec 100 -- \
  systemd-run \
    --working-directory=/opt/opensource-server/create-a-container \
    -p EnvironmentFile=/etc/default/container-creator \
    -P npx sequelize-cli db:migrate
```
