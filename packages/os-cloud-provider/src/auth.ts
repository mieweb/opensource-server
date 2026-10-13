/**
 * `whoami`, `login`, `logout`.
 *
 * `login` is a loopback handoff (issue #475 §3b/§4.3): listen on
 * 127.0.0.1:<random>, open the browser at the Manager's
 * `/api/v1/auth/cli/callback?port&state`, and wait for the Manager to redirect
 * back to `http://127.0.0.1:<port>/callback#code=…&state=…`. The CLI then
 * redeems that one-time code (POST /api/v1/auth/cli/token) for an API key in
 * its own request, so no key exists unless this process received it.
 * Browsers never send the fragment to a server, so `/callback` returns a small
 * page that POSTs it to `/token` on the same listener.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { hostname as osHostname } from 'node:os';
import type { AuthStatus, DeployContext, DeployLogger } from '@mieweb/deploy-contract';
import open from 'open';
import { ManagerClient } from './client.ts';
import {
  DEFAULT_INSTANCE_URL,
  instanceFromArgv,
  normalizeInstanceUrl,
  resolveInstanceUrl,
  resolveToken,
} from './config.ts';
import { writeCredential, type StoredCredential } from './credentials.ts';
import type { ProviderDeps } from './deploy.ts';
import { ttyPrompter } from './prompt.ts';

function clientFor(ctx: DeployContext, deps: ProviderDeps, instanceUrl: string, token: string | null): ManagerClient {
  return new ManagerClient({ instanceUrl, token, target: ctx.target, signal: ctx.signal, fetch: deps.fetch });
}

/** The account a token belongs to (`get_session`). */
async function sessionUser(client: ManagerClient): Promise<string> {
  return (await client.call((api) => api.GET('/session')))?.user ?? '';
}

export async function whoami(ctx: DeployContext, deps: ProviderDeps): Promise<AuthStatus> {
  const instanceUrl = resolveInstanceUrl(deps.env, ctx.targetConfig);
  const tok = await resolveToken(deps.env, instanceUrl);
  if (!tok) return { authenticated: false };
  try {
    const account = await sessionUser(clientFor(ctx, deps, instanceUrl, tok.token));
    return { authenticated: true, account, method: tok.method };
  } catch (err) {
    if ((err as Error).name === 'AuthError') return { authenticated: false, method: tok.method };
    throw err;
  }
}

// --- login ------------------------------------------------------------------

export interface LoginHooks {
  /** Open a URL in the user's browser (default: the `open` package). */
  openBrowser?: (url: string) => void;
  /** Give up waiting after this long (default 5 min). */
  timeoutMs?: number;
}

function defaultOpenBrowser(url: string): void {
  // The URL is always printed too; a missing opener isn't fatal.
  open(url).then(
    (child) => child.on('error', () => {}),
    () => {},
  );
}

/** Instance for `login`: --instance → env → targetConfig.instanceUrl → prompt (default os.mieweb.org). */
async function loginInstanceUrl(ctx: DeployContext, deps: ProviderDeps): Promise<string> {
  const configured =
    instanceFromArgv(ctx.argv) ||
    deps.env.MIEWEB_OS_URL?.trim() ||
    (typeof ctx.targetConfig.instanceUrl === 'string' ? ctx.targetConfig.instanceUrl.trim() : '');
  if (configured) return normalizeInstanceUrl(configured);
  const answer = ((await (deps.prompt ?? ttyPrompter)(`Manager URL [${DEFAULT_INSTANCE_URL}]: `, false)) ?? '').trim();
  return normalizeInstanceUrl(answer || DEFAULT_INSTANCE_URL);
}

const CALLBACK_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>mieweb login</title>
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem}</style></head>
<body><div role="status" aria-live="polite"><h1 id="t">Finishing sign-in…</h1><p id="m"></p></div><script>
(async () => {
  const t = document.getElementById('t'), m = document.getElementById('m');
  const frag = location.hash.slice(1);
  history.replaceState(null, '', location.pathname);
  try {
    const r = await fetch('/token', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: frag });
    if (!r.ok) throw new Error(await r.text());
    t.textContent = 'Signed in'; m.textContent = 'You can close this tab and return to the terminal.';
  } catch (e) {
    t.textContent = 'Sign-in failed'; m.textContent = String(e.message || e);
  }
})();
</script></body></html>`;

/** What the browser hands the loopback: a one-time code to redeem for a key. */
interface Handoff {
  code: string;
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function readBody(req: IncomingMessage, limit = 8192): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      body += chunk;
      if (body.length > limit) {
        reject(new Error('body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

/** Start the loopback listener; resolves the handoff once a valid `/token` POST arrives. */
export async function startLoopback(
  state: string,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<{ port: number; result: Promise<Handoff>; close: () => void }> {
  let settle!: { resolve: (h: Handoff) => void; reject: (e: unknown) => void };
  const result = new Promise<Handoff>((resolve, reject) => {
    settle = { resolve, reject };
  });

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const send = (status: number, type: string, body: string): void => {
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
      res.end(body);
    };
    if (req.method === 'GET' && url.pathname === '/callback') {
      send(200, 'text/html; charset=utf-8', CALLBACK_PAGE);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/token') {
      // Only our own callback page (same origin) may post the handoff.
      const origin = req.headers.origin;
      const self = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      if (origin !== undefined && origin !== self) {
        send(403, 'text/plain', 'Forbidden origin');
        return;
      }
      readBody(req).then(
        (body) => {
          const p = new URLSearchParams(body);
          const code = p.get('code') ?? '';
          if (!safeEqual(p.get('state') ?? '', state)) {
            send(400, 'text/plain', 'State mismatch — this sign-in was not started by this terminal. Re-run `mieweb login`.');
            return;
          }
          if (!code) {
            send(400, 'text/plain', 'The Manager did not return a sign-in code.');
            return;
          }
          send(200, 'text/plain', 'ok');
          settle.resolve({ code });
        },
        () => send(400, 'text/plain', 'Bad request'),
      );
      return;
    }
    send(404, 'text/plain', 'Not found');
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const port = (server.address() as { port: number }).port;

  const timeout = AbortSignal.timeout(timeoutMs);
  const stop = AbortSignal.any([signal, timeout]);
  const onAbort = (): void =>
    settle.reject(timeout.aborted && !signal.aborted ? new Error('Timed out waiting for the browser sign-in') : signal.reason);
  stop.addEventListener('abort', onAbort, { once: true });
  // An abort during listen() already fired; AbortSignal doesn't replay it.
  if (stop.aborted) onAbort();
  const close = (): void => {
    stop.removeEventListener('abort', onAbort);
    server.closeAllConnections();
    server.close();
  };
  return { port, result, close };
}

function clientLabel(): string {
  const host = osHostname().toLowerCase().replace(/[^a-z0-9._-]/g, '-').slice(0, 40) || 'host';
  return `mieweb-cli@${host}`;
}

export async function login(ctx: DeployContext, deps: ProviderDeps, hooks: LoginHooks = {}): Promise<void> {
  const { logger } = ctx;
  const instanceUrl = await loginInstanceUrl(ctx, deps);
  if (deps.env.MIEWEB_OS_TOKEN?.trim()) {
    logger.warn('MIEWEB_OS_TOKEN is set in the environment and takes precedence over the login cache.');
  }

  // Fail fast (before opening a browser) if the instance isn't a Manager.
  await clientFor(ctx, deps, instanceUrl, null).call((api) => api.GET('/health'), { auth: false });

  const state = randomBytes(24).toString('base64url');
  const loop = await startLoopback(state, ctx.signal, hooks.timeoutMs ?? 5 * 60 * 1000);
  try {
    const params = new URLSearchParams({ port: String(loop.port), state, client: clientLabel() });
    const authUrl = `${instanceUrl}/api/v1/auth/cli/callback?${params.toString()}`;
    logger.info(`Opening your browser to sign in to ${instanceUrl}`);
    logger.info(`If it doesn't open, visit: ${authUrl}`);
    (hooks.openBrowser ?? defaultOpenBrowser)(authUrl);

    const handoff = await loop.result;
    // Redeem the one-time code for a key in our own request: the Manager only
    // creates the key now, so a login that gave up earlier leaves none behind.
    const client = clientFor(ctx, deps, instanceUrl, null);
    const redeemed = await client.call(
      (api) => api.POST('/auth/cli/token', { body: { code: handoff.code, state } }),
      { auth: false },
    );
    if (!redeemed?.key || !redeemed.id) throw new Error('The Manager did not return an API key for the sign-in code');
    const cred: StoredCredential = {
      token: redeemed.key,
      apiKeyId: redeemed.id,
      user: redeemed.user,
      savedAt: new Date().toISOString(),
    };
    // Revoke the key this login replaces, so repeated logins don't pile up keys.
    const previous = await writeCredential(deps.env, instanceUrl, cred);
    if (previous && previous.apiKeyId !== cred.apiKeyId) await revoke(instanceUrl, previous, ctx, deps, logger);
    logger.info(`Logged in to ${instanceUrl} as ${cred.user}`);
  } finally {
    loop.close();
  }
}

/** Revoke a key (best effort: warns if the Manager can't be reached). */
async function revoke(
  instanceUrl: string,
  key: StoredCredential,
  ctx: DeployContext,
  deps: ProviderDeps,
  logger: DeployLogger,
): Promise<void> {
  try {
    await clientFor(ctx, deps, instanceUrl, key.token).call((api) =>
      api.DELETE('/apikeys/{id}', { params: { path: { id: key.apiKeyId } } }),
    );
  } catch (err) {
    ctx.signal.throwIfAborted();
    // Already deleted, or no longer valid: nothing left to revoke.
    if ((err as Error).name === 'AuthError' || (err as { status?: number }).status === 404) return;
    logger.warn(`Could not revoke API key ${key.apiKeyId} on ${instanceUrl}; delete it under API Keys in the web UI`);
  }
}

export async function logout(ctx: DeployContext, deps: ProviderDeps): Promise<void> {
  const { logger } = ctx;
  const explicit = instanceFromArgv(ctx.argv) || deps.env.MIEWEB_OS_URL?.trim();
  const instanceUrl = explicit ? normalizeInstanceUrl(explicit) : resolveInstanceUrl(deps.env, ctx.targetConfig);
  if (deps.env.MIEWEB_OS_TOKEN?.trim()) {
    logger.warn('MIEWEB_OS_TOKEN is set in the environment; logout cannot clear it. Unset it to fully log out.');
  }
  const previous = await writeCredential(deps.env, instanceUrl, null);
  if (previous) await revoke(instanceUrl, previous, ctx, deps, logger);
  logger.info(previous ? `Logged out of ${instanceUrl}` : `Not logged in to ${instanceUrl}`);
}
