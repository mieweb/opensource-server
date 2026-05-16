# MCP Server for VS Code

Use the MCP (Model Context Protocol) server to manage your containers through AI assistants like GitHub Copilot or Claude directly inside VS Code.

**Prerequisites:**
- VS Code with an MCP-capable AI extension (e.g., [GitHub Copilot](https://marketplace.visualstudio.com/items?itemName=GitHub.copilot), [Claude for VS Code](https://marketplace.visualstudio.com/items?itemName=AnthropicPublicBeta.claude-for-vscode))
- [uv](https://docs.astral.sh/uv/getting-started/installation/) installed
- An API key from [your server]({{ manager_url }}/apikeys) (see [API Keys](./creating-containers/api-keys.md))

## 1. Configure VS Code

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

## 2. Verify the Connection

After saving the config, restart VS Code. Open the MCP server list (`Ctrl+Shift+P` → "MCP: List Servers") to confirm `container-manager` shows a green status.

## 3. Use It

Ask your AI assistant to interact with your containers using natural language. Example prompts:

- *"List all my containers"*
- *"Create a new Ubuntu container on site 1"*
- *"What's the status of job 42?"*
- *"Delete container 105 on site 1"*
- *"Show my API keys"*

The assistant translates your request into the appropriate API call and returns the result.

!!! note

    The MCP server inherits the permissions of your API key. It can only perform actions your key is authorized for.
