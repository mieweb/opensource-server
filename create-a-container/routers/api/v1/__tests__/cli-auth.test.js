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

  test('a proxy base path (X-Forwarded-Prefix) is kept in the sign-in and return URLs', async () => {
    const res = await request(app)
      .get(`${BASE}?port=53682&state=${STATE}`)
      .set(...REMOTE)
      .set('X-Forwarded-Prefix', '/manager/');
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.location, 'http://manager.test');
    expect(loc.pathname).toBe('/manager/login');
    expect(loc.searchParams.get('redirect')).toBe(`/manager${BASE}?port=53682&state=${STATE}`);
  });

  test('the confirmation page keeps the base path in its form action and Cancel link', async () => {
    const agent = await loggedInAgent(app, 'alice');
    const res = await agent.get(`${BASE}?port=53682&state=${STATE}`).set(...REMOTE).set('X-Forwarded-Prefix', '/manager');
    expect(res.text).toContain(`action="/manager${BASE}"`);
    expect(res.text).toContain('href="/manager/">Cancel');
  });

  test.each(['//evil.example', 'https://evil.example', '/a/../b', '/a b'])('an unsafe X-Forwarded-Prefix %j is ignored', async (prefix) => {
    const res = await request(app).get(`${BASE}?port=53682&state=${STATE}`).set(...REMOTE).set('X-Forwarded-Prefix', prefix);
    expect(new URL(res.headers.location, 'http://manager.test').pathname).toBe('/login');
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

  async function authorize(agent, state = STATE) {
    const form = await agent.get(`${BASE}?port=53682&state=${state}&client=cli`).set(...REMOTE);
    return agent
      .post(BASE)
      .set(...REMOTE)
      .type('form')
      .send({ _csrf: csrfFrom(form.text), port: '53682', state, client: 'cli' });
  }
  const redeem = (body) => request(app).post('/api/v1/auth/cli/token').set(...REMOTE).send(body);

  test('POST hands the loopback a one-time code (no key yet); the CLI redeems it for a working key', async () => {
    const agent = await loggedInAgent(app, 'alice');
    const before = await ApiKey.count({ where: { uidNumber: alice.uidNumber } });
    const res = await authorize(agent);
    expect(res.status).toBe(303);
    const loc = new URL(res.headers.location);
    expect(loc.origin).toBe('http://127.0.0.1:53682');
    expect(loc.pathname).toBe('/callback');
    expect(loc.search).toBe('');
    const frag = new URLSearchParams(loc.hash.slice(1));
    expect(frag.get('state')).toBe(STATE);
    expect(frag.get('key')).toBeNull();
    const code = frag.get('code');
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await ApiKey.count({ where: { uidNumber: alice.uidNumber } })).toBe(before);

    // Redeemed by the CLI: no session, no CSRF token.
    const tok = await redeem({ code, state: STATE });
    expect(tok.status).toBe(200);
    expect(tok.body.data.user).toBe('alice');
    const row = await ApiKey.findByPk(tok.body.data.id);
    expect(row.uidNumber).toBe(alice.uidNumber);
    expect(row.description).toMatch(/^cli \(CLI login/);
    const session = await request(app).get('/api/v1/session').set(...bearer(tok.body.data.key));
    expect(session.body.data.user).toBe('alice');

    // Idempotent: a retry (e.g. after a lost response) gets the same key, and
    // still only one key exists.
    const again = await redeem({ code, state: STATE });
    expect(again.status).toBe(200);
    expect(again.body.data).toEqual(tok.body.data);
    expect(await ApiKey.count({ where: { uidNumber: alice.uidNumber } })).toBe(before + 1);
  });

  test('an oversized redemption body is rejected by the 4 KB limit', async () => {
    const body = { code: 'x'.repeat(8 * 1024), state: STATE };
    expect((await redeem(body)).status).toBe(413);
    // Every spelling Express routes to the endpoint gets the same limit.
    for (const path of ['/api/v1/auth/cli/token/', '/API/v1/auth/cli/Token']) {
      const res = await request(app).post(path).set(...REMOTE).send(body);
      expect(res.status).toBe(413);
    }
  });

  test('concurrent redemptions of one code mint a single key', async () => {
    const agent = await loggedInAgent(app, 'alice');
    const before = await ApiKey.count({ where: { uidNumber: alice.uidNumber } });
    const code = new URLSearchParams(new URL((await authorize(agent)).headers.location).hash.slice(1)).get('code');
    const [a, b] = await Promise.all([redeem({ code, state: STATE }), redeem({ code, state: STATE })]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.body.data.id).toBe(b.body.data.id);
    expect(await ApiKey.count({ where: { uidNumber: alice.uidNumber } })).toBe(before + 1);
  });

  test('a code is bound to its state, and a wrong state burns it', async () => {
    const agent = await loggedInAgent(app, 'alice');
    const code = new URLSearchParams(new URL((await authorize(agent)).headers.location).hash.slice(1)).get('code');
    expect((await redeem({ code, state: 'some-other-state-0123456' })).status).toBe(400);
    expect((await redeem({ code, state: STATE })).status).toBe(400);
  });

  test('an unredeemed code expires (a CLI that gave up leaves no key)', async () => {
    const agent = await loggedInAgent(app, 'alice');
    const before = await ApiKey.count({ where: { uidNumber: alice.uidNumber } });
    const code = new URLSearchParams(new URL((await authorize(agent)).headers.location).hash.slice(1)).get('code');
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now + 3 * 60 * 1000);
    try {
      expect((await redeem({ code, state: STATE })).status).toBe(400);
    } finally {
      jest.restoreAllMocks();
    }
    expect(await ApiKey.count({ where: { uidNumber: alice.uidNumber } })).toBe(before);
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
    expect(await ApiKey.count({ where: { uidNumber: alice.uidNumber } })).toBe(before);
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
    expect(await ApiKey.count({ where: { uidNumber: alice.uidNumber } })).toBe(before);
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
