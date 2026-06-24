"""Django middleware for signed proxy identity assertions.

Add to ``MIDDLEWARE`` in settings::

    MIDDLEWARE = [
        # ...
        "trusted_proxy_auth.django.TrustedProxyAuthMiddleware",
    ]

Configuration is read from the shared ``TRUSTED_PROXY_*`` environment
variables. The verified identity is attached to the request as
``request.trusted_proxy_identity``.
"""

from __future__ import annotations

from typing import Any, Callable

from jwt import PyJWKClient

from . import (
    Config,
    InvalidAssertionError,
    load_config_from_env,
    verify_assertion,
    _validate_config,
)


def _django_unauthorized() -> Any:
    from django.http import JsonResponse

    return JsonResponse({"error": "invalid_assertion"}, status=401)


class TrustedProxyAuthMiddleware:
    def __init__(self, get_response: Callable[[Any], Any], config: Config | None = None):
        self.get_response = get_response
        self.config = config or load_config_from_env()
        _validate_config(self.config)
        self.jwks_client = PyJWKClient(self.config.jwks_url)
        self._meta_key = "HTTP_" + self.config.header.upper().replace("-", "_")

    def __call__(self, request: Any) -> Any:
        token = (request.META.get(self._meta_key) or "").strip()
        if not token:
            return _django_unauthorized()
        try:
            request.trusted_proxy_identity = verify_assertion(token, self.config, self.jwks_client)
        except InvalidAssertionError:
            return _django_unauthorized()
        return self.get_response(request)
