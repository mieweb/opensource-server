"""WSGI middleware for signed proxy identity assertions (Flask and friends).

Flask apps are WSGI, so wrap the app's WSGI callable::

    from trusted_proxy_auth import load_config_from_env
    from trusted_proxy_auth.flask import TrustedProxyAuthMiddleware

    app.wsgi_app = TrustedProxyAuthMiddleware(app.wsgi_app, load_config_from_env())

The verified identity is exposed on the WSGI environ as
``trusted_proxy_identity`` and is reachable in a view via
``request.environ["trusted_proxy_identity"]``.
"""

from __future__ import annotations

from typing import Any, Callable, Iterable

from jwt import PyJWKClient

from . import (
    UNAUTHORIZED_BODY,
    Config,
    InvalidAssertionError,
    load_config_from_env,
    verify_assertion,
    _validate_config,
)

StartResponse = Callable[[str, list[tuple[str, str]]], Any]


class TrustedProxyAuthMiddleware:
    def __init__(self, app: Callable[..., Iterable[bytes]], config: Config | None = None):
        self.app = app
        self.config = config or load_config_from_env()
        _validate_config(self.config)
        self.jwks_client = PyJWKClient(self.config.jwks_url)
        self._environ_key = "HTTP_" + self.config.header.upper().replace("-", "_")

    def __call__(self, environ: dict[str, Any], start_response: StartResponse) -> Iterable[bytes]:
        token = (environ.get(self._environ_key) or "").strip()
        if not token:
            return _reject(start_response)
        try:
            environ["trusted_proxy_identity"] = verify_assertion(token, self.config, self.jwks_client)
        except InvalidAssertionError:
            return _reject(start_response)
        return self.app(environ, start_response)


def _reject(start_response: StartResponse) -> Iterable[bytes]:
    start_response("401 Unauthorized", [("Content-Type", "application/json")])
    return [UNAUTHORIZED_BODY]
