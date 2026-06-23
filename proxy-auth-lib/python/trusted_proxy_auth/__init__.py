from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any

import jwt
from jwt import InvalidTokenError, PyJWKClient

UNAUTHORIZED_BODY = b'{"error":"invalid_assertion"}'


@dataclass(frozen=True)
class Config:
    header: str
    jwks_url: str
    issuer: str
    audience: str


@dataclass(frozen=True)
class Identity:
    subject: str
    email: str | None
    name: str | None
    claims: dict[str, Any]


class AssertionError(Exception):
    pass


class TrustedProxyAuthMiddleware:
    def __init__(self, app: Any, config: Config):
        _validate_config(config)
        self.app = app
        self.config = config
        self.jwks_client = PyJWKClient(config.jwks_url)

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        try:
            token = _read_header(scope, self.config.header)
            if token is None:
                raise AssertionError("missing assertion")
            scope["trusted_proxy_identity"] = verify_assertion(token, self.config, self.jwks_client)
            await self.app(scope, receive, send)
        except AssertionError:
            await send(
                {
                    "type": "http.response.start",
                    "status": 401,
                    "headers": [(b"content-type", b"application/json")],
                }
            )
            await send({"type": "http.response.body", "body": UNAUTHORIZED_BODY})


def load_config_from_env(env: dict[str, str] | None = None) -> Config:
    values = env or os.environ
    return Config(
        header=values.get("TRUSTED_PROXY_ASSERTION_HEADER", ""),
        jwks_url=values.get("TRUSTED_PROXY_JWKS_URL", ""),
        issuer=values.get("TRUSTED_PROXY_ISSUER", ""),
        audience=values.get("TRUSTED_PROXY_AUDIENCE", ""),
    )


def verify_assertion(token: str, config: Config, jwks_client: PyJWKClient | None = None) -> Identity:
    _validate_config(config)
    client = jwks_client or PyJWKClient(config.jwks_url)
    try:
        signing_key = client.get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            issuer=config.issuer,
            audience=config.audience,
            options={"require": ["exp", "iss", "aud", "sub"]},
        )
    except (InvalidTokenError, ValueError) as error:
        raise AssertionError("invalid assertion") from error

    return Identity(
        subject=claims["sub"],
        email=claims.get("email"),
        name=claims.get("name"),
        claims=json.loads(json.dumps(claims)),
    )


def _read_header(scope: dict[str, Any], header_name: str) -> str | None:
    target = header_name.lower().encode()
    for name, value in scope.get("headers", []):
        if name == target and value.strip():
            return value.decode().strip()
    return None


def _validate_config(config: Config) -> None:
    for key in ("header", "jwks_url", "issuer", "audience"):
        if not getattr(config, key):
            raise ValueError(f"missing config: {key}")
