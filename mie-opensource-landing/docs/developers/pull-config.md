---
sidebar_position: 7
---

# pull-config

Cron-based configuration management that pulls config files from the manager API. Installed on agent and manager containers. For deployment instructions, see [Deploying Agents](/docs/admins/deploying-agents).

## Architecture

Executable instance scripts in `/etc/pull-config.d/` are run every minute by cron via `run-parts`. Each script sources environment variables, sets service-specific config, and calls the main pull-config binary.

```
pull-config/
├── bin/
│   └── pull-config          # Main script (called by instance scripts)
├── etc/
│   ├── cron.d/
│   │   └── pull-config      # Single cron entry: run-parts /etc/pull-config.d
│   └── pull-config.d/       # Executable instance scripts
│       ├── nginx
│       ├── dnsmasq-conf
│       ├── dnsmasq-dhcp-hosts
│       ├── dnsmasq-hosts
│       ├── dnsmasq-dhcp-opts
│       └── dnsmasq-servers
└── install.sh               # Copies scripts to /etc/
```

## Environment Variables

Sourced from `/etc/environment` by each instance script. Set via container runtime (Docker `ENV`, Proxmox LXC config) — the base image's `environment.sh` service propagates them on boot.

| Variable | Required | Description |
|----------|----------|-------------|
| `SITE_ID` | Yes | Numeric site ID from the manager |
| `MANAGER_URL` | Yes | Base URL of the manager (e.g., `http://192.168.1.10:3000`) |
| `API_KEY` | No | Bearer token for remote agents. Not needed on the manager (localhost is trusted). |

The agent Dockerfile defaults to `SITE_ID=1` and `MANAGER_URL=http://localhost:3000` so the manager container works without configuration.

## Instance Script Variables

Each instance script exports these before calling `exec /opt/opensource-server/pull-config/bin/pull-config`:

### Required (must be exported)

| Variable | Description |
|----------|-------------|
| `CONF_FILE` | Target configuration file path |
| `CONF_URL` | URL to fetch configuration from |

### Optional

| Variable | Description |
|----------|-------------|
| `TEST_COMMAND` | Command to validate config before applying (e.g., `nginx -t`) |
| `RELOAD_COMMAND` | Custom command to reload the service |
| `SERVICE_NAME` | Service name for `systemctl reload-or-restart` fallback |

## Adding an Instance

Create an executable script in `/etc/pull-config.d/`:

```bash
#!/usr/bin/env bash

set -a; . /etc/environment; set +a

export CONF_FILE=/etc/myservice/config.conf
export CONF_URL=${MANAGER_URL}/sites/${SITE_ID}/myservice.conf
export TEST_COMMAND="myservice --validate-config"
export SERVICE_NAME="myservice"

exec /opt/opensource-server/pull-config/bin/pull-config
```

```bash
sudo chmod +x /etc/pull-config.d/myservice
```

The cron job picks it up automatically on the next run.

### File Naming

`run-parts` only executes files matching: `a-zA-Z0-9_-` (no dots — use `nginx` not `nginx.sh`).

## Behavior

- **ETag caching** — only downloads when the manager reports a change (HTTP 304)
- **Validation** — runs `TEST_COMMAND` before applying; rolls back on failure
- **API key auth** — sends `Authorization: Bearer $API_KEY` when `API_KEY` is set
- **Reload** — uses `RELOAD_COMMAND` if set, otherwise `systemctl reload-or-restart $SERVICE_NAME`
