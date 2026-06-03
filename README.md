# opensource-server

Self-service LXC container hosting on Proxmox VE — web UI, automated DNS/reverse proxy, LDAP authentication, and ACME TLS.

Full documentation lives in [`mie-opensource-landing/docs/`](mie-opensource-landing/docs/) and is published to the project documentation site.

## Get Started

| If you want to... | Read |
|---|---|
| Install and operate a production deployment | [Installation Guide](mie-opensource-landing/docs/admins/installation.md) |
| Run just the Manager web app locally (`make dev`, SQLite) | [Run the Manager Locally](mie-opensource-landing/docs/developers/development-workflow.md#run-the-manager-locally-make-dev) |
| Run the full stack locally to develop or contribute | [Development Workflow](mie-opensource-landing/docs/developers/development-workflow.md) |
| Use a deployed cluster as an end user (create containers, etc.) | [User Getting Started](mie-opensource-landing/docs/users/getting-started.md) |
| Contribute changes | [Contributing](mie-opensource-landing/docs/developers/contributing.md) |
| Understand the system design | [System Architecture](mie-opensource-landing/docs/developers/system-architecture.md) |

## Repository Layout

| Path | Purpose |
|---|---|
| [`create-a-container/`](create-a-container/) | Manager web application (Node.js + Express + Sequelize) |
| [`pull-config/`](pull-config/) | Cron-driven config distribution for nginx and dnsmasq on agents — see [pull-config docs](mie-opensource-landing/docs/developers/pull-config.md) |
| [`images/`](images/) | Docker Bake definitions for the `base`, `nodejs`, `agent`, and `manager` images — see [Docker Images](mie-opensource-landing/docs/developers/docker-images.md) |
| [`manager-control-program/`](manager-control-program/) | MCP server for AI-assisted container management — see [MCP Server](mie-opensource-landing/docs/users/mcp-server.md) |
| [`mie-opensource-landing/`](mie-opensource-landing/) | Documentation site source |
| [`error-pages/`](error-pages/) | Static error pages served by NGINX |
| [`compose.yml`](compose.yml) | Local development stack (used by the Development Workflow guide) |

## Contributors

<a href="https://github.com/mieweb/opensource-server/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=mieweb/opensource-server" alt="Contributors" />
</a>

Made with [contrib.rocks](https://contrib.rocks).
