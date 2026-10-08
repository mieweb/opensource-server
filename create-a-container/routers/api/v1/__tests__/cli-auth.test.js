/**
 * Integration tests for the CLI loopback login handoff (issue #475 §4.3):
 * GET/POST /api/v1/auth/cli/callback.
 *
 * Requests carry a non-localhost X-Forwarded-For so the CSRF guard's
 * localhost bypass doesn't apply; that way the session + CSRF path is the
 * real one a browser takes.
 */

const request = require('supertest');
const { buildApp, bearer } = require('../../../../tests/helpers/app');
const { resetDb, closeDb, createUser, createApiKey } = require('../../../../tests/helpers/db');
const { ApiKey } = require('../../../../models');
const { parseHandoff } = require('../cli-auth');

const REMOTE = ['X-Forwarded-For', '203.0.113.7'];
const STATE = 'abcdefghijklmnop0123456789';
const BASE = '/api/v1/auth/cli/callback';

async function loggedInAgent(app, uid) {
  const agent = request.agent(app);
  const csrf = await agent.get('/api/v1/csrf-token').set(...REMOTE);
  const token = csrf.body.data.csrfToken;
  const res = await agent
    .post('/api/v1/auth/login')
    .set(...REMOTE)
    .set('X-CSRF-Token', token)
    .send({ username: uid, password: 'correct horse battery staple' });
  expect(res.status).toBe(200);
  return agent;
}

function csrfFrom(html) {
  const m = html.match(/name="_csrf" value="([^"]+)"/);
  return m && m[1];
}

describe('parseHandoff', () => {
  test('accepts a valid port/state/client', () => {
    expect(parseHandoff({ port: '53682', state: STATE, client: 'mieweb-cli@laptop' })).toEqual({
      port: 53682,
      state: STATE,
      client: 'mieweb-cli@laptop',
    });
  });

  test.each([
    [{ port: '80', state: STATE }],
    [{ port: '70000', state: STATE }],
    [{ port: '5368a', state: STATE }],
    [{ port: '053682', state: STATE }],
    [{ port: '53682', state: 'short' }],
    [{ port: '53682', state: `${STATE}<script>` }],
    [{ port: '53682', state: STATE, client: 'evil host/../x' }],
  ])('rejects %j', (input) => {
    expect(() => parseHandoff(input)).toThrow();
  });
});

describe('/api/v1/auth/cli/callback', () => {
  let app;
  let alice;

  beforeAll(async () => {
    await resetDb();
    app = buildApp();
    await createUser({ uid: 'firstadmin' });
    alice = await createUser({ uid: 'alice' });
  });

  afterAll(async () => {
    await closeDb();
  });

  test('bad params render an error page and never redirect', async () => {
    const res = await request(app).get(`${BASE}?port=22&state=${STATE}`).set(...REMOTE);
    expect(res.status).toBe(400);
    expect(res.type).toBe('text/html');
    expect(res.headers.location).toBeUndefined();
  });

  test('unauthenticated GET bounces to the SPA login with a relative return URL', async () => {
    const res = await request(app)
      .get(`${BASE}?port=53682&state=${STATE}&client=cli&junk=1`)
      .set(...REMOTE);
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.location, 'http://manager.test');
    expect(loc.pathname).toBe('/login');
    const back = loc.searchParams.get('redirect');
    expect(back).toBe(`${BASE}?port=53682&state=${STATE}&client=cli`);
  });

  test('authenticated GET shows a confirmation form and mints nothing', async () => {
    const agent = await loggedInAgent(app, 'alice');
    const before = await ApiKey.count({ where: { uidNumber: alice.uidNumber } });
    const res = await agent.get(`${BASE}?port=53682&state=${STATE}`).set(...REMOTE);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Authorize command-line access');
    expect(res.text).toContain('127.0.0.1:53682');
    expect(csrfFrom(res.text)).toBeTruthy();
    expect(await ApiKey.count({ where: { uidNumber: alice.uidNumber } })).toBe(before);
  });

  test('POST without a CSRF token is rejected', async () => {
    const agent = await loggedInAgent(app, 'alice');
    const res = await agent
      .post(BASE)
      .set(...REMOTE)
      .type('form')
      .send({ port: '53682', state: STATE });
    expect(res.status).toBe(403);
  });

  test('POST with session + CSRF mints a working key and redirects to the loopback fragment', async () => {
    const agent = await loggedInAgent(app, 'alice');
    const form = await agent.get(`${BASE}?port=53682&state=${STATE}&client=cli`).set(...REMOTE);
    const res = await agent
      .post(BASE)
      .set(...REMOTE)
      .type('form')
      .send({ _csrf: csrfFrom(form.text), port: '53682', state: STATE, client: 'cli' });
    expect(res.status).toBe(303);
    const loc = new URL(res.headers.location);
    expect(loc.origin).toBe('http://127.0.0.1:53682');
    expect(loc.pathname).toBe('/callback');
    expect(loc.search).toBe('');
    const frag = new URLSearchParams(loc.hash.slice(1));
    expect(frag.get('state')).toBe(STATE);
    expect(frag.get('user')).toBe('alice');
    const key = frag.get('key');
    expect(key).toBeTruthy();

    const row = await ApiKey.findByPk(frag.get('id'));
    expect(row.uidNumber).toBe(alice.uidNumber);
    expect(row.description).toMatch(/^cli \(CLI login/);

    const session = await request(app).get('/api/v1/session').set(...bearer(key));
    expect(session.status).toBe(200);
    expect(session.body.data.user).toBe('alice');
  });

  test('the handoff is one-time: a replayed POST mints no second key', async () => {
    const agent = await loggedInAgent(app, 'alice');
    const form = await agent.get(`${BASE}?port=53682&state=${STATE}`).set(...REMOTE);
    const body = { _csrf: csrfFrom(form.text), port: '53682', state: STATE };
    const before = await ApiKey.count({ where: { uidNumber: alice.uidNumber } });
    const first = await agent.post(BASE).set(...REMOTE).type('form').send(body);
    expect(first.status).toBe(303);
    const replay = await agent.post(BASE).set(...REMOTE).type('form').send(body);
    expect(replay.status).toBe(400);
    expect(replay.text).toMatch(/already completed or has expired/);
    expect(await ApiKey.count({ where: { uidNumber: alice.uidNumber } })).toBe(before + 1);
  });

  test('two concurrent POSTs of the same handoff mint only one key', async () => {
    const agent = await loggedInAgent(app, 'alice');
    const state = 'concurrentstate0123456789';
    const form = await agent.get(`${BASE}?port=53682&state=${state}`).set(...REMOTE);
    const body = { _csrf: csrfFrom(form.text), port: '53682', state };
    const before = await ApiKey.count({ where: { uidNumber: alice.uidNumber } });
    const results = await Promise.all([
      agent.post(BASE).set(...REMOTE).type('form').send(body),
      agent.post(BASE).set(...REMOTE).type('form').send(body),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([303, 400]);
    expect(await ApiKey.count({ where: { uidNumber: alice.uidNumber } })).toBe(before + 1);
  });

  test('a POST without a matching confirmation page (other state/port) is rejected', async () => {
    const agent = await loggedInAgent(app, 'alice');
    const form = await agent.get(`${BASE}?port=53682&state=${STATE}`).set(...REMOTE);
    const res = await agent
      .post(BASE)
      .set(...REMOTE)
      .type('form')
      .send({ _csrf: csrfFrom(form.text), port: '53683', state: STATE });
    expect(res.status).toBe(400);
  });

  test('a Bearer key cannot mint another key through the handoff', async () => {
    const { plainKey } = await createApiKey(alice);
    const res = await request(app)
      .post(BASE)
      .set(...REMOTE)
      .set(...bearer(plainKey))
      .type('form')
      .send({ port: '53682', state: STATE });
    expect(res.status).toBe(401);
  });
});
