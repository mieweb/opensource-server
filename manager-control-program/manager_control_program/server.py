import os

import httpx
from awslabs.openapi_mcp_server.server import load_config, create_mcp_server, setup_signal_handlers
from fastmcp.server.dependencies import get_http_headers

# Transports accepted via SERVER_TRANSPORT. "http" is fastmcp's streamable
# HTTP transport ("streamable-http" is an alias); "sse" is the legacy
# HTTP+Server-Sent-Events transport kept for older MCP clients.
HTTP_TRANSPORTS = ("http", "streamable-http", "sse")


class ForwardAuthorizationHeader(httpx.Auth):
    """Per-request auth for HTTP mode: forward the MCP caller's credentials.

    When the server runs over an HTTP transport, every tool call arrives as an
    HTTP request from the MCP client. fastmcp exposes those request headers
    through a context variable, so at the moment the generated tool sends its
    API request we copy the caller's Authorization header onto it. Each caller
    therefore authenticates to the API as themselves — no shared AUTH_TOKEN
    has to exist at startup.

    fastmcp's own header passthrough (OpenAPITool.run) deliberately strips
    `authorization`, hence the explicit include here. Outside an HTTP request
    context get_http_headers() returns {}, making this a no-op that falls
    back to whatever static auth (if any) is configured on the client.
    """

    def auth_flow(self, request):
        incoming = get_http_headers(include={"authorization"})
        authorization = incoming.get("authorization")
        if authorization:
            request.headers["Authorization"] = authorization
        yield request


def main():
    # We require API_BASE_URL to be set by the user so we know how to route API
    # requests.
    api_base_url = os.getenv("API_BASE_URL")
    if not api_base_url:
        raise RuntimeError(
            "API_BASE_URL environment variable must be set to the base URL of the API "
            "(for example, 'https://example.com')."
        )

    api_base_url = api_base_url.rstrip("/")

    # The default for the API_SPEC_URL is the shown path, but we allow the user
    # to override it. This is useful when testing spec changes.
    if "API_SPEC_URL" not in os.environ:
        os.environ["API_SPEC_URL"] = f"{api_base_url}/api/openapi.json"

    # SERVER_TRANSPORT selects how MCP clients connect (awslabs' load_config
    # reads the same variable, along with SERVER_HOST/SERVER_PORT):
    #   - "stdio" (default): single local client, static credentials.
    #   - "http"/"streamable-http"/"sse": shared network server, per-request
    #     credentials forwarded from each caller (see ForwardAuthorizationHeader).
    transport = os.environ.get("SERVER_TRANSPORT", "stdio").strip().lower()
    if transport != "stdio" and transport not in HTTP_TRANSPORTS:
        raise RuntimeError(
            f"Unsupported SERVER_TRANSPORT '{transport}'. "
            f"Expected 'stdio' or one of: {', '.join(HTTP_TRANSPORTS)}."
        )

    if "AUTH_TYPE" not in os.environ:
        if transport == "stdio":
            # We default to Bearer auth which requires the user to have set the
            # AUTH_TOKEN environment variable. I'm unsure if any other auth
            # types work, but we leave that door open incase it's needed.
            os.environ["AUTH_TYPE"] = "bearer"
        else:
            # HTTP mode: callers supply their own Authorization header on each
            # request, so don't demand a static AUTH_TOKEN at startup. Setting
            # AUTH_TYPE=bearer explicitly (with AUTH_TOKEN) still works and
            # acts as a fallback for requests that omit the header.
            os.environ["AUTH_TYPE"] = "none"

    # The rest of this is more-or-less copied from the official
    # awslabs.openapi_mpc_server.server:main function with the small exception
    # of setting the Accept header to application/json. The official defaults to
    # */* which makes our API return HTML instead of the JSON response, breaking
    # the API spec.
    config = load_config()
    mcp_server = create_mcp_server(config)
    mcp_server._client.headers['accept'] = 'application/json'
    setup_signal_handlers()

    if transport == "stdio":
        mcp_server.run()
        return

    # Forward each caller's Authorization header to the API. Client-level auth
    # runs on every request the generated tools send (they use this shared
    # httpx client), and takes precedence over any static default header.
    mcp_server._client.auth = ForwardAuthorizationHeader()
    mcp_server.run(transport=transport, host=config.host, port=config.port)


if __name__=='__main__':
    main()
