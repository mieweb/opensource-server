/**
 * Run a built app on one fixed loopback port. OAuth tests need this: the
 * issuer and token audience are the request origin, and supertest's
 * in-process requests would use a new ephemeral port each time.
 */

/** @returns {Promise<{ server, base: string }>} */
async function listenApp(app) {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

module.exports = { listenApp, close };
