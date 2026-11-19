/**
 * Client ID Metadata Documents (MCP authorization spec 2026-07-28): an HTTPS
 * URL used as client_id, fetched by oidc-provider. The fetch is stubbed on
 * Node's main-realm global (where the provider runs; see
 * tests/oidc-provider-native.js), except for the SSRF case, which must be
 * refused before any network access.
 */

const request = require('supertest');
const { buildApp } = require('../../../tests/helpers/app');
const { listenApp, close } = require('../../../tests/helpers/listen');
const { resetDb, closeDb, createUser } = require('../../../tests/helpers/db');
const { REMOTE, loggedInAgent } = require('../../../tests/helpers/session');
const { REDIRECT_URI, pkcePair, authorizeUrl, startAuthorization, authorize, exchangeCode } = require('../../../tests/helpers/oauth');
const { OAuthPayload } = require('../../../models');

// Node's native require (Jest's `module` is sandboxed), as in the shim.
const { createRequire } = process.getBuiltinModule('module');
const { mainGlobal } = createRequire(__filename)('../../../tests/main-realm.js');

const CLIENT_ID = 'https://app.example.com/oauth/client-metadata.json';
const doc = (overrides = {}) => ({
  client_id: CLIENT_ID,
  client_name: 'Example MCP Client',
  redirect_uris: [REDIRECT_URI],
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  token_endpoint_auth_method: 'none',
  ...overrides,
});

describe('Client ID Metadata Document clients', () => {
  let server;
  let base;
  let realFetch;
  let served;

  beforeAll(async () => {
    await resetDb();
    ({ server, base } = await listenApp(buildApp()));
    await createUser({ uid: 'firstadmin' });
    await createUser({ uid: 'alice' });
    realFetch = mainGlobal.fetch;
    mainGlobal.fetch = async (url, options) => {
      if (String(url).startsWith('https://app.example.com/')) {
        return new mainGlobal.Response(JSON.stringify(served), {
          headers: { 'content-type': 'application/json', 'cache-control': 'max-age=0' },
        });
      }
      return realFetch(url, options);
    };
  });

  afterAll(async () => {
    mainGlobal.fetch = realFetch;
    await close(server);
    await closeDb();
  });

  const client = { client_id: CLIENT_ID };

  test('consent shows the document host; approve -> token; display info kept on the grant', async () => {
    served = doc();
    const agent = await loggedInAgent(base, 'alice');
    const page = await startAuthorization(agent, base, client, { challenge: pkcePair().challenge });
    expect(page.status).toBe(200);
    expect(page.text).toContain('Example MCP Client');
    expect(page.text).toContain('Identified by <code>app.example.com</code>');

    const { code, verifier } = await authorize(agent, base, client);
    const res = await exchangeCode(base, client, { code, verifier });
    expect(res.status).toBe(200);
    expect(res.body.refresh_token).toEqual(expect.any(String));

    const grant = await OAuthPayload.findOne({ where: { model: 'Grant', clientId: CLIENT_ID } });
    expect(grant.meta).toMatchObject({ clientName: 'Example MCP Client', registrationType: 'metadata_document' });
  });

  test('client_id mismatch in the document -> error page, no redirect', async () => {
    served = doc({ client_id: 'https://evil.example/x.json' });
    // A different URL so the provider's cache from the previous test doesn't apply.
    const other = { client_id: 'https://app.example.com/oauth/other.json' };
    const res = await request(base).get(authorizeUrl(other, { challenge: pkcePair().challenge })).set(...REMOTE);
    expect(res.status).toBe(400);
    expect(res.headers.location).toBeUndefined();
  });

  test.each([
    'https://127.0.0.1/client.json',
    'https://10.0.0.1/client.json',
  ])('private address %s is refused (SSRF)', async (url) => {
    // The provider's guard drops the socket on connect; a blackholed address
    // waits for its 2.5 s fetch timeout.
    const res = await request(base).get(authorizeUrl({ client_id: url }, { challenge: pkcePair().challenge })).set(...REMOTE);
    expect(res.status).toBe(400);
    expect(res.headers.location).toBeUndefined();
  }, 15_000);
});
