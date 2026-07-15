# agent

Site agent for opensource-server. A oneshot Node.js script, launched every 30 seconds by a systemd timer, that checks in with the manager (`POST /api/v1/agents`), reports host and service status, and renders, tests and applies nginx and dnsmasq configuration from the returned snapshot.

- **Admin guide:** [Deploying Agents](https://mieweb.github.io/opensource-server/docs/admins/deploying-agents) — installation and configuration
- **Developer reference:** [agent](https://mieweb.github.io/opensource-server/docs/developers/agent) — check-in protocol, apply/rollback flow, managed services
