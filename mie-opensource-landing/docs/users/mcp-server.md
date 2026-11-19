# MCP Server

Use the MCP (Model Context Protocol) server to manage your containers through AI assistants like GitHub Copilot or Claude directly inside VS Code.

There are two ways to use it:

- **Run it locally (stdio)** — VS Code launches a private copy of the server for you, authenticated with your API key from the environment.
- **Connect to the built-in server (HTTP)** — packaged deployments already serve MCP at `{{ manager_url }}/mcp`. Configure only the URL and sign in through your browser, or send an API key. Nothing to install, so start here.

**Prerequisites:**
- VS Code with an MCP-capable AI extension (e.g., [GitHub Copilot](https://marketplace.visualstudio.com/items?itemName=GitHub.copilot), [Claude for VS Code](https://marketplace.visualstudio.com/items?itemName=AnthropicPublicBeta.claude-for-vscode))
- An API key from [your server]({{ manager_url }}/apikeys) (see [API Keys](./creating-containers/api-keys.md)) — not needed for browser sign-in (Option B)
- [uv](https://docs.astral.sh/uv/getting-started/installation/) installed (local stdio mode only)

## Option A: Run It Locally (stdio)

Open your VS Code settings (`Ctrl+Shift+P` → "Preferences: Open User Settings (JSON)") and add the MCP server:

```json
{
  "mcp": {
    "servers": {
      "container-manager": {
        "command": "uvx",
        "args": [
          "--from",
          "manager-control-program@git+https://github.com/mieweb/opensource-server.git#subdirectory=manager-control-program",
          "manager-control-program"
        ],
        "env": {
          "API_BASE_URL": "https://your-server-domain",
          "AUTH_TOKEN": "your-api-key"
        }
      }
    }
  }
}
```

| Field | Description |
|-------|-------------|
| `API_BASE_URL` | Base URL of your server (same domain you use in the browser) |
| `AUTH_TOKEN` | Your API key (see [API Keys](./creating-containers/api-keys.md)) |

!!! tip

    You can also add this to a **workspace-level** `.vscode/settings.json` to share the config with your team (omit `AUTH_TOKEN` and set it as a system environment variable instead).

## Option B: Connect to the Built-in Server (HTTP)

Every packaged deployment ships the MCP server as a system service and exposes it at `/mcp` on the same domain as the web UI. Nothing to install.

### Sign in with your browser (OAuth)

Configure only the URL:

```json
{
  "mcp": {
    "servers": {
      "container-manager": {
        "url": "{{ manager_url }}/mcp"
      }
    }
  }
}
```

On first use the client opens your browser. Sign in as you normally do (password or your organization's single sign-on), check the application name and redirect address on the consent screen, and approve. The client stores and refreshes the token itself.

The manager is its own OAuth 2.1 authorization server:

| | |
|---|---|
| Discovery | `/.well-known/oauth-protected-resource/mcp`, `/.well-known/oauth-authorization-server` |
| Client registration | Client ID Metadata Documents, or dynamic registration at `/oauth/register` |
| Flow | Authorization code + PKCE (S256); access tokens last 1 hour, refresh tokens 30 days and rotate on use |
| Scope | `manager` — the token acts as you, with your full permissions, like an API key |

Unauthenticated requests to `/mcp` get `401` with `WWW-Authenticate: Bearer resource_metadata="…"`, which is what starts the sign-in in MCP clients. The same token works at `/mcp` and `/api/v1`: the MCP server forwards it to the API on the same manager.

### Use an API key

Clients without OAuth support (and scripts) can send an API key instead. Your key is forwarded to the API on every request, so you act under your own account and permissions:

```json
{
  "mcp": {
    "servers": {
      "container-manager": {
        "url": "{{ manager_url }}/mcp",
        "headers": {
          "Authorization": "Bearer your-api-key"
        }
      }
    }
  }
}
```

### How the Built-in Server Is Hosted

The `opensource-mcp` package (installed automatically as a dependency of `opensource-server`) ships the MCP server with vendored Python dependencies at `/opt/opensource-server/manager-control-program` and runs it as the `opensource-mcp.service` systemd unit, listening on loopback (`127.0.0.1:8100`). The Manager reverse-proxies `/mcp` to it, providing the public hostname and TLS. It is enabled by default; admins can:

- change settings (e.g. `SERVER_PORT`) in the packaged config file `/etc/default/opensource-mcp`, then restart the service
- disable it entirely with `systemctl disable --now opensource-mcp.service` (and unset `MCP_SERVER_URL` for `container-creator.service` to remove the proxy route)

### Hosting a Standalone Server

Outside a packaged deployment, the same HTTP mode runs anywhere `uv` is available:

```bash
API_BASE_URL=https://your-server-domain SERVER_TRANSPORT=http \
  uvx --from "manager-control-program @ git+https://github.com/mieweb/opensource-server.git#subdirectory=manager-control-program" \
  manager-control-program
```

| Variable | Description |
|----------|-------------|
| `SERVER_TRANSPORT` | `http` (streamable HTTP), or `sse` for legacy clients. Defaults to `stdio` |
| `SERVER_HOST` | Bind address (default `127.0.0.1`) |
| `SERVER_PORT` | Port (default `8000`) |

No `AUTH_TOKEN` is required at startup: each caller authenticates with their own key, and requests without an `Authorization` header are rejected by the API.

!!! warning

    The MCP server forwards tokens without validating them and serves plain HTTP. If you expose it beyond localhost, put it behind an HTTPS reverse proxy and restrict who can reach it.

## Verify the Connection

After saving the config, restart VS Code. Open the MCP server list (`Ctrl+Shift+P` → "MCP: List Servers") to confirm `container-manager` shows a green status.

## Use It

Ask your AI assistant to interact with your containers using natural language. Example prompts:

- *"List all my containers"*
- *"Create a new Ubuntu container on site 1"*
- *"What's the status of job 42?"*
- *"Delete container 105 on site 1"*
- *"Show my API keys"*

The assistant translates your request into the appropriate API call and returns the result.

!!! note

    The MCP server inherits the permissions of your API key or OAuth sign-in. It can only perform actions your account is authorized for.
