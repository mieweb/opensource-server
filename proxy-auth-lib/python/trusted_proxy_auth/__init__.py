from __future__ import annotations

import json
import os
import socket
from copy import deepcopy
from dataclasses import dataclass
from typing import Any

import jwt
from jwt import InvalidTokenError, PyJWKClient

UNAUTHORIZED_RESPONSE = {"error": "invalid_assertion"}
UNAUTHORIZED_BODY = json.dumps(UNAUTHORIZED_RESPONSE, separators=(",", ":")).encode()

# Reasonable defaults so every setting is optional. The auth domain is derived
# from the host's FQDN (`web1.os.example.org` -> `auth.os.example.org`); issuer
# and JWKS come from it. Override any single value with its own env var.
DEFAULT_ASSERTION_HEADER = "X-Trusted-Proxy-Assertion"


def derive_auth_domain(hostname: str | None = None) -> str:
    host = hostname or socket.getfqdn()
    labels = [label for label in host.split(".") if label]
    parent = ".".join(labels[1:]) if len(labels) > 1 else (labels[0] if labels else "localhost")
    return f"auth.{parent}"


@dataclass(frozen=True)
class Config:
    header: str
    jwks_url: str
    issuer: str
    audience: str
    public_key: str | None = None


@dataclass(frozen=True)
class Identity:
    subject: str
    email: str | None
    name: str | None
    claims: dict[str, Any]


class InvalidAssertionError(Exception):
    pass


class TrustedProxyAuthMiddleware:
    def __init__(self, app: Any, config: Config):
        _validate_config(config)
        self.app = app
        self.config = config
        self.jwks_client = None if config.public_key else PyJWKClient(config.jwks_url)

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        try:
            token = _read_header(scope, self.config.header)
            if token is None:
                raise InvalidAssertionError("missing assertion")
            scope["trusted_proxy_identity"] = verify_assertion(token, self.config, self.jwks_client)
            await self.app(scope, receive, send)
        except InvalidAssertionError:
            await send(
                {
                    "type": "http.response.start",
                    "status": 401,
                    "headers": [(b"content-type", b"application/json")],
                }
            )
            await send({"type": "http.response.body", "body": UNAUTHORIZED_BODY})


def load_config_from_env(env: dict[str, str] | None = None, hostname: str | None = None) -> Config:
    values = env or os.environ
    domain = values.get("TRUSTED_PROXY_AUTH_DOMAIN") or derive_auth_domain(hostname)
    base = f"https://{domain}"
    return Config(
        header=values.get("TRUSTED_PROXY_ASSERTION_HEADER") or DEFAULT_ASSERTION_HEADER,
        jwks_url=values.get("TRUSTED_PROXY_JWKS_URL") or f"{base}/.well-known/jwks.json",
        issuer=values.get("TRUSTED_PROXY_ISSUER") or base,
        audience=values.get("TRUSTED_PROXY_AUDIENCE") or base,
        public_key=_resolve_public_key(values),
    )


# JWKS is preferred for key rotation. A static public key (PEM) is an opt-in
# alternative for self-signed assertions: when set, verification uses it
# directly and never touches the network.
def _resolve_public_key(values: Any) -> str | None:
    inline = values.get("TRUSTED_PROXY_PUBLIC_KEY")
    if inline:
        return inline
    path = values.get("TRUSTED_PROXY_PUBLIC_KEY_FILE")
    if path:
        with open(path, encoding="utf-8") as handle:
            return handle.read()
    return None


def verify_assertion(token: str, config: Config, jwks_client: PyJWKClient | None = None) -> Identity:
    _validate_config(config)
    try:
        if config.public_key:
            signing_key: Any = config.public_key
        else:
            client = jwks_client or PyJWKClient(config.jwks_url)
            signing_key = client.get_signing_key_from_jwt(token).key
        claims = jwt.decode(
            token,
            signing_key,
            algorithms=["RS256"],
            issuer=config.issuer,
            audience=config.audience,
            options={"require": ["exp", "iss", "aud", "sub"]},
        )
    except (InvalidTokenError, ValueError) as error:
        raise InvalidAssertionError("invalid assertion") from error

    return Identity(
        subject=claims["sub"],
        email=claims.get("email"),
        name=claims.get("name"),
        claims=deepcopy(claims),
    )


def _read_header(scope: dict[str, Any], header_name: str) -> str | None:
    target = header_name.lower().encode()
    for name, value in scope.get("headers", []):
        if name != target:
            continue
        decoded = value.decode().strip()
        if decoded:
            return decoded
    return None


def _validate_config(config: Config) -> None:
    for key in ("header", "issuer", "audience"):
        if not getattr(config, key):
            raise ValueError(f"missing config: {key}")
    if not config.public_key and not config.jwks_url:
        raise ValueError("missing config: jwks_url or public_key")
