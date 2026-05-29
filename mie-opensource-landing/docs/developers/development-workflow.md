# Development Workflow

The entire stack — Proxmox, Manager, docs, and bootstrap — runs locally inside Docker.

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/)

## Start the Stack

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

## Manager Image Selection

By default the compose stack deploys `ghcr.io/mieweb/opensource-server/manager:latest`. Override the tag by setting `MANAGER_TAG` in your environment or in a `.env` file alongside `compose.yml`:

```bash
MANAGER_TAG=my-feature-branch docker compose up -d
```

The template download step checks your **local** Docker images first, so a locally-built `manager:<tag>` image is used without pulling from GHCR — handy for testing in-progress changes to the Manager image itself.

!!! note "Reusing a tag"
    The downloaded template tarball is persisted in the named `local` volume so subsequent `docker compose up` cycles start quickly. To pick up a new build of the same tag, either:

    - Delete the cached tar file from the `local` volume, or
    - Recreate the volume (e.g., `docker compose down -v`).

## Persistent State and Full Reset

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

## Endpoints

| URL | Description |
|---|---|
| `https://localhost:8006` | Proxmox Web UI |
| `http://localhost` | Redirects to `https://localhost` |
| `https://localhost` | Documentation site |
| `https://manager.localhost` | Manager Web UI |

## Credentials and Shell Access

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

## Live Reload

The local git repository is mounted **read-only** into `/opt/opensource-server` on the Manager container, so source changes on the host are visible immediately.

| Component | Reload behavior |
|---|---|
| Manager server | Auto-restarted by `nodemon` |
| Manager UI (React client) | Auto-rebuilt by the `client` service |
| Documentation | Auto-rebuilt by the `zensical` service |
| Job runner | Restart manually |
| Database migrations | Run manually in the proper server context (see below) |

### Frontend Rebuilds

The Manager serves the compiled React app from `create-a-container/client/dist`; it does **not** run the Vite dev server. Because the repository is mounted **read-only** into the Manager container, Vite can't write build output from there. Instead, the dedicated `client` service mounts the repository **read-write** and runs `vite build --watch`, rebuilding `client/dist` on the host whenever the client source changes.

The Manager container's read-only bind mount still reflects those host changes, so the running server picks up the new bundle on the next request — just refresh your browser. No `nodemon` restart is required for client-only changes.

!!! note "First build on a fresh checkout"
    The `client` service performs an initial build before Proxmox starts serving (the `proxmox` service waits for it to become healthy), so a bundle always exists even on a clean checkout where `client/dist` isn't present yet.


### Run Database Migrations

```bash
docker compose exec proxmox pct exec 100 -- \
  systemd-run \
    --working-directory=/opt/opensource-server/create-a-container \
    -p EnvironmentFile=/etc/default/container-creator \
    -P npx sequelize-cli db:migrate
```
