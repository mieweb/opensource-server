/**
 * Browser-session helpers for supertest.
 *
 * Requests carry a non-localhost X-Forwarded-For so csrfGuard's localhost
 * bypass doesn't apply; the session + CSRF path is then the real one a
 * browser takes.
 */

const request = require('supertest');

const REMOTE = ['X-Forwarded-For', '203.0.113.7'];
const PASSWORD = 'correct horse battery staple';

/** A supertest agent with a password-login session for `uid`. */
async function loggedInAgent(app, uid) {
  const agent = request.agent(app);
  const csrf = await agent.get('/api/v1/csrf-token').set(...REMOTE);
  const res = await agent
    .post('/api/v1/auth/login')
    .set(...REMOTE)
    .set('X-CSRF-Token', csrf.body.data.csrfToken)
    .send({ username: uid, password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed for ${uid}: ${res.status} ${JSON.stringify(res.body)}`);
  return agent;
}

/** The `_csrf` hidden field of a server-rendered form. */
function csrfFrom(html) {
  const m = html.match(/name="_csrf" value="([^"]+)"/);
  return m && m[1];
}

module.exports = { REMOTE, PASSWORD, loggedInAgent, csrfFrom };
