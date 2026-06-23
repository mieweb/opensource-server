import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { before, after, describe, test } from 'node:test';

import { createTrustedProxyAuth, loadConfigFromEnv, verifyAssertion } from '../src/index.mjs';

const tokens = JSON.parse(await readFile(new URL('../../testdata/tokens.json', import.meta.url), 'utf8'));
const jwks = await readFile(new URL('../../testdata/jwks.json', import.meta.url), 'utf8');

let server;
let jwksUrl;
const config = {
  header: 'x-trusted-proxy-assertion',
  jwksUrl: '',
  issuer: 'https://issuer.example.test',
  audience: 'my-service',
};

before(async () => {
  server = createServer((req, res) => {
    if (req.url !== '/jwks.json') {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.end(jwks);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  jwksUrl = `http://127.0.0.1:${port}/jwks.json`;
  config.jwksUrl = jwksUrl;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe('verifyAssertion', () => {
  test('accepts a valid assertion', async () => {
    const identity = await verifyAssertion(tokens.valid, config);
    assert.equal(identity.subject, 'user-123');
    assert.equal(identity.email, 'user@example.test');
    assert.equal(identity.name, 'Example User');
  });

  for (const key of ['expired', 'invalid_signature', 'wrong_issuer', 'wrong_audience', 'malformed']) {
    test(`rejects ${key} assertions`, async () => {
      await assert.rejects(() => verifyAssertion(tokens[key], config));
    });
  }
});

describe('createTrustedProxyAuth', () => {
  async function invoke(token) {
    let nextCalled = false;
    const req = {
      headers: token ? { 'x-trusted-proxy-assertion': token } : {},
      get(name) {
        return this.headers[name.toLowerCase()];
      },
    };
    const res = {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
      },
      end(payload) {
        this.body = payload;
      },
    };

    await createTrustedProxyAuth(config)(req, res, () => {
      nextCalled = true;
    });

    return { req, res, nextCalled };
  }

  test('sets req.trustedProxyIdentity for a valid assertion', async () => {
    const result = await invoke(tokens.valid);
    assert.equal(result.nextCalled, true);
    assert.equal(result.req.trustedProxyIdentity.subject, 'user-123');
  });

  for (const key of ['missing', 'expired', 'invalid_signature', 'wrong_issuer', 'wrong_audience', 'malformed']) {
    test(`returns 401 for ${key} assertions`, async () => {
      const result = await invoke(key === 'missing' ? null : tokens[key]);
      assert.equal(result.nextCalled, false);
      assert.equal(result.res.statusCode, 401);
      assert.deepEqual(result.res.body, { error: 'invalid_assertion' });
    });
  }

  test('loads the shared environment variable names', () => {
    assert.deepEqual(
      loadConfigFromEnv({
        TRUSTED_PROXY_ASSERTION_HEADER: 'x-test',
        TRUSTED_PROXY_JWKS_URL: jwksUrl,
        TRUSTED_PROXY_ISSUER: config.issuer,
        TRUSTED_PROXY_AUDIENCE: config.audience,
      }),
      {
        header: 'x-test',
        jwksUrl,
        issuer: config.issuer,
        audience: config.audience,
      },
    );
  });
});
