# manager-control-program

MCP server that exposes the [create-a-container](../create-a-container/) REST API as [Model Context Protocol](https://modelcontextprotocol.io/) tools. It reads the OpenAPI spec at runtime from `create-a-container` and auto-generates MCP tool definitions using [`awslabs-openapi-mcp-server`](https://github.com/awslabs/mcp/tree/main/src/openapi-mcp-server), so it stays in sync with API changes automatically.

## Prerequisites

- Python 3.13+
- [uv](https://docs.astral.sh/uv/) package manager
- A running `create-a-container` instance with API access
- A bearer token (API key) from `create-a-container`

## Setup

```bash
uv sync
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `API_BASE_URL` | **Yes** | Base URL of the `create-a-container` instance (e.g., `https://containers.example.com`) |
| `AUTH_TOKEN` | **Yes** | Bearer token for API authentication (create one at `/apikeys` in `create-a-container`) |

The server automatically sets `API_SPEC_URL` to `${API_BASE_URL}/api/openapi.json` and `AUTH_TYPE` to `bearer`.

## Usage

### From a Local Clone

```bash
API_BASE_URL=https://containers.example.com AUTH_TOKEN=your-api-key uv run manager-control-program
```

### From Git (No Clone Required)

```bash
API_BASE_URL=https://containers.example.com AUTH_TOKEN=your-api-key \
  uvx --from "manager-control-program @ git+https://github.com/mieweb/opensource-server.git#subdirectory=manager-control-program" \
  manager-control-program
```

### MCP Client Configuration

Add to your MCP client config (e.g., Claude Desktop, VS Code):

```json
{
  "mcpServers": {
    "container-manager": {
      "command": "uvx",
      "args": [
        "--from",
        "manager-control-program @ git+https://github.com/mieweb/opensource-server.git#subdirectory=manager-control-program",
        "manager-control-program"
      ],
      "env": {
        "API_BASE_URL": "https://containers.example.com",
        "AUTH_TOKEN": "your-api-key"
      }
    }
  }
}
```

## How It Works

```mermaid
graph LR
    A[MCP Client<br/>e.g. Claude] -->|MCP protocol<br/>stdio| B[manager-control-program]
    B -->|GET /api/openapi.json| C[create-a-container]
    B -->|REST API calls<br/>Bearer auth| C
```

1. On startup, fetches the OpenAPI spec from `create-a-container`
2. Generates an MCP tool for each API operation (list containers, create jobs, etc.)
3. Proxies tool calls as authenticated REST requests to the API

## Available Tools

Tools are generated dynamically from the OpenAPI spec. Typical operations include:

- **API Keys** — list, create, update, delete API keys
- **Containers** — list, create, inspect, delete LXC containers
- **Jobs** — create and monitor provisioning jobs
- **Storage** — query available Proxmox storage
