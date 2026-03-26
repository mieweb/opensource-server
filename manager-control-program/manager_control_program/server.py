import os
import awslabs.openapi_mcp_server
from awslabs.openapi_mcp_server.server import load_config, create_mcp_server, setup_signal_handlers

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

    # We default to Bearer auth with requires the user to have set the
    # AUTH_TOKEN environment variable. I'm unsure if any other auth types work,
    # but we leave that door open incase it's needed.
    if "AUTH_TYPE" not in os.environ:
        os.environ["AUTH_TYPE"] = "bearer"

    # The rest of this is more-or-less copied from the official
    # awslabs.openapi_mpc_server.server:main function with the small exception
    # of setting the Accept header to application/json. The official defaults to
    # */* which makes our API return HTML instead of the JSON response, breaking
    # the API spec.
    config = load_config()
    mcp_server = create_mcp_server(config)
    mcp_server._client.headers['accept'] = 'application/json'
    setup_signal_handlers()
    mcp_server.run()

if __name__=='__main__':
    main()
