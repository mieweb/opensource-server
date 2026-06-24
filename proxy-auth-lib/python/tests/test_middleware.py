from __future__ import annotations

import asyncio
import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import mock

from trusted_proxy_auth import Config, TrustedProxyAuthMiddleware, load_config_from_env, verify_assertion
from trusted_proxy_auth.django import TrustedProxyAuthMiddleware as DjangoMiddleware
from trusted_proxy_auth.flask import TrustedProxyAuthMiddleware as FlaskMiddleware

FIXTURES = Path(__file__).resolve().parents[2] / "testdata"
TOKENS = json.loads((FIXTURES / "tokens.json").read_text())
JWKS = (FIXTURES / "jwks.json").read_bytes()


class JwksHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        if self.path != "/jwks.json":
            self.send_response(404)
            self.end_headers()
            return

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(JWKS)

    def log_message(self, format: str, *args: object) -> None:  # noqa: A003
        return


class TrustedProxyAuthTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), JwksHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.config = Config(
            header="x-trusted-proxy-assertion",
            jwks_url=f"http://127.0.0.1:{cls.server.server_port}/jwks.json",
            issuer="https://issuer.example.test",
            audience="my-service",
        )

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.thread.join(timeout=5)

    async def test_accepts_valid_assertion(self) -> None:
        identity = verify_assertion(TOKENS["valid"], self.config)
        self.assertEqual(identity.subject, "user-123")
        self.assertEqual(identity.email, "user@example.test")
        self.assertEqual(identity.name, "Example User")

    async def test_rejects_missing_expired_invalid_and_malformed_assertions(self) -> None:
        for key in ["expired", "invalid_signature", "wrong_issuer", "wrong_audience", "malformed"]:
            with self.subTest(key=key):
                with self.assertRaises(Exception):
                    verify_assertion(TOKENS[key], self.config)

    async def test_asgi_middleware_exposes_verified_identity(self) -> None:
        async def app(scope, receive, send):
            identity = scope["trusted_proxy_identity"]
            await send({"type": "http.response.start", "status": 200, "headers": [(b"content-type", b"application/json")]})
            await send({"type": "http.response.body", "body": json.dumps({"subject": identity.subject}).encode()})

        middleware = TrustedProxyAuthMiddleware(app, self.config)
        status, body = await invoke(middleware, TOKENS["valid"], self.config.header)
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), {"subject": "user-123"})

    async def test_asgi_middleware_returns_401_for_invalid_assertions(self) -> None:
        middleware = TrustedProxyAuthMiddleware(empty_app, self.config)
        for key in [None, "expired", "invalid_signature", "wrong_issuer", "wrong_audience", "malformed"]:
            with self.subTest(key=key):
                status, body = await invoke(middleware, TOKENS[key] if key else None, self.config.header)
                self.assertEqual(status, 401)
                self.assertEqual(json.loads(body), {"error": "invalid_assertion"})

    async def test_load_config_from_env_uses_shared_names(self) -> None:
        config = load_config_from_env(
            {
                "TRUSTED_PROXY_ASSERTION_HEADER": "x-test",
                "TRUSTED_PROXY_JWKS_URL": self.config.jwks_url,
                "TRUSTED_PROXY_ISSUER": self.config.issuer,
                "TRUSTED_PROXY_AUDIENCE": self.config.audience,
            }
        )
        self.assertEqual(config.header, "x-test")
        self.assertEqual(config.jwks_url, self.config.jwks_url)

    async def test_load_config_from_env_derives_auth_domain_from_host(self) -> None:
        derived = load_config_from_env({}, "web1.os.example.org")
        self.assertEqual(derived.header, "X-Trusted-Proxy-Assertion")
        self.assertEqual(derived.issuer, "https://auth.os.example.org")
        self.assertEqual(derived.jwks_url, "https://auth.os.example.org/.well-known/jwks.json")
        self.assertEqual(derived.audience, "https://auth.os.example.org")

        override = load_config_from_env({"TRUSTED_PROXY_AUTH_DOMAIN": "auth.example.test"}, "web1.os.example.org")
        self.assertEqual(override.issuer, "https://auth.example.test")
        self.assertEqual(override.jwks_url, "https://auth.example.test/.well-known/jwks.json")

    async def test_static_public_key_verifies_without_network(self) -> None:
        public_key = (FIXTURES / "public-key.pem").read_text()
        config = Config(
            header="x-trusted-proxy-assertion",
            jwks_url="",
            issuer="https://issuer.example.test",
            audience="my-service",
            public_key=public_key,
        )
        identity = verify_assertion(TOKENS["valid"], config)
        self.assertEqual(identity.subject, "user-123")
        with self.assertRaises(Exception):
            verify_assertion(TOKENS["invalid_signature"], config)

    async def test_load_config_from_env_reads_inline_public_key(self) -> None:
        config = load_config_from_env(
            {"TRUSTED_PROXY_PUBLIC_KEY": "-----BEGIN PUBLIC KEY-----\nMII...\n-----END PUBLIC KEY-----"}
        )
        self.assertIn("BEGIN PUBLIC KEY", config.public_key)

    async def test_flask_wsgi_middleware_exposes_identity(self) -> None:
        def app(environ, start_response):
            identity = environ["trusted_proxy_identity"]
            start_response("200 OK", [("Content-Type", "application/json")])
            return [json.dumps({"subject": identity.subject}).encode()]

        middleware = FlaskMiddleware(app, self.config)
        status, body = call_wsgi(middleware, TOKENS["valid"], self.config.header)
        self.assertTrue(status.startswith("200"))
        self.assertEqual(json.loads(body), {"subject": "user-123"})

    async def test_flask_wsgi_middleware_rejects_invalid(self) -> None:
        middleware = FlaskMiddleware(wsgi_ok_app, self.config)
        for key in [None, "expired", "invalid_signature", "wrong_issuer", "wrong_audience", "malformed"]:
            with self.subTest(key=key):
                status, body = call_wsgi(middleware, TOKENS[key] if key else None, self.config.header)
                self.assertTrue(status.startswith("401"))
                self.assertEqual(json.loads(body), {"error": "invalid_assertion"})

    async def test_django_middleware_exposes_identity_and_rejects(self) -> None:
        meta_key = "HTTP_" + self.config.header.upper().replace("-", "_")
        sentinel = object()
        response_marker = object()

        def get_response(request):
            return response_marker

        with mock.patch("trusted_proxy_auth.django._django_unauthorized", return_value=sentinel):
            middleware = DjangoMiddleware(get_response, self.config)

            valid_request = _FakeRequest({meta_key: TOKENS["valid"]})
            self.assertIs(middleware(valid_request), response_marker)
            self.assertEqual(valid_request.trusted_proxy_identity.subject, "user-123")

            for key in [None, "expired", "invalid_signature", "wrong_issuer", "wrong_audience", "malformed"]:
                with self.subTest(key=key):
                    meta = {} if key is None else {meta_key: TOKENS[key]}
                    self.assertIs(middleware(_FakeRequest(meta)), sentinel)


class _FakeRequest:
    def __init__(self, meta: dict[str, str]):
        self.META = meta


def wsgi_ok_app(environ, start_response):
    start_response("200 OK", [])
    return [b"ok"]


def call_wsgi(app, token: str | None, header_name: str) -> tuple[str, bytes]:
    environ = {"REQUEST_METHOD": "GET", "PATH_INFO": "/"}
    if token is not None:
        environ["HTTP_" + header_name.upper().replace("-", "_")] = token
    captured: dict[str, str] = {}

    def start_response(status: str, headers: list[tuple[str, str]]) -> None:
        captured["status"] = status

    body = b"".join(app(environ, start_response))
    return captured["status"], body


async def empty_app(scope, receive, send):
    await send({"type": "http.response.start", "status": 200, "headers": []})
    await send({"type": "http.response.body", "body": b"ok"})


async def invoke(app, token: str | None, header_name: str) -> tuple[int, bytes]:
    headers = [] if token is None else [(header_name.encode(), token.encode())]
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/",
        "headers": headers,
    }
    received = False
    messages = []

    async def receive():
        nonlocal received
        if received:
            await asyncio.sleep(0)
            return {"type": "http.disconnect"}
        received = True
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        messages.append(message)

    await app(scope, receive, send)

    status = next(message["status"] for message in messages if message["type"] == "http.response.start")
    body = b"".join(message.get("body", b"") for message in messages if message["type"] == "http.response.body")
    return status, body


if __name__ == "__main__":
    unittest.main()
