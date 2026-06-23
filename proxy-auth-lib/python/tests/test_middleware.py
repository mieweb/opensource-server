from __future__ import annotations

import asyncio
import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from trusted_proxy_auth import Config, TrustedProxyAuthMiddleware, load_config_from_env, verify_assertion

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
