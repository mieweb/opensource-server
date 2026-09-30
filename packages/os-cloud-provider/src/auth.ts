/**
 * `whoami`, `login`, `logout`.
 *
 * `login` is a loopback handoff (issue #475 §3b/§4.3): listen on
 * 127.0.0.1:<random>, open the browser at the Manager's
 * `/api/v1/auth/cli/callback?port&state`, and wait for the Manager to redirect
 * back to `http://127.0.0.1:<port>/callback#key=…&id=…&user=…&state=…`.
 * Browsers never send the fragment to a server, so `/callback` returns a small
 * page that POSTs it to `/token` on the same listener.
 */

import { spawn } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { hostname as osHostname } from 'node:os';
import { createInterface } from 'node:readline/promises';
import type { AuthStatus, DeployContext, DeployLogger } from '@mieweb/deploy-contract';
import type { SessionInfo } from './api-types.ts';
import { ManagerClient } from './client.ts';
import {
  DEFAULT_INSTANCE_URL,
  instanceFromArgv,
  normalizeInstanceUrl,
  resolveInstanceUrl,
  resolveToken,
} from './config.ts';
import { deleteCredential, readCredential, writeCredential } from './credentials.ts';
import type { ProviderDeps } from './deploy.ts';

export async function whoami(ctx: DeployContext, deps: ProviderDeps): Promise<AuthStatus> {
  const instanceUrl = resolveInstanceUrl(deps.env, ctx.targetConfig);
  const tok = await resolveToken(deps.env, instanceUrl);
  if (!tok) return { authenticated: false };
  const client = new ManagerClient({ instanceUrl, token: tok.token, target: ctx.target, signal: ctx.signal, fetch: deps.fetch });
  try {
    const session = await client.get<SessionInfo>('/session');
    return { authenticated: true, account: session.user, method: tok.method };
  } catch (err) {
    if ((err as Error).name === 'AuthError') return { authenticated: false, method: tok.method };
    throw err;
  }
}

// --- login ------------------------------------------------------------------

export interface LoginHooks {
  /** Open a URL in the user's browser (default: platform opener). */
  openBrowser?: (url: string) => void;
  /** Ask for the instance URL when nothing configures it. */
  prompt?: (question: string) => Promise<string>;
  /** Give up waiting after this long (default 5 min). */
  timeoutMs?: number;
}

function defaultOpenBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '""', url] : [url];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // The URL is always printed too; a missing opener isn't fatal.
  }
}

async function defaultPrompt(question: string): Promise<string> {
  if (!process.stdin.isTTY) return '';
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

/** Instance for `login`: --instance → env → targetConfig.instanceUrl → prompt (default os.mieweb.org). */
async function loginInstanceUrl(ctx: DeployContext, deps: ProviderDeps, hooks: LoginHooks): Promise<string> {
  const configured =
    instanceFromArgv(ctx.argv) ||
    deps.env.MIEWEB_OS_URL?.trim() ||
    (typeof ctx.targetConfig.instanceUrl === 'string' ? ctx.targetConfig.instanceUrl.trim() : '');
  if (configured) return normalizeInstanceUrl(configured);
  const answer = (await (hooks.prompt ?? defaultPrompt)(`Manager URL [${DEFAULT_INSTANCE_URL}]: `)).trim();
  return normalizeInstanceUrl(answer || DEFAULT_INSTANCE_URL);
}

const CALLBACK_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>mieweb login</title>
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem}</style></head>
<body><h1 id="t">Finishing sign-in…</h1><p id="m"></p><script>
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

interface Handoff {
  key: string;
  id: string;
  user: string;
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
          const key = p.get('key') ?? '';
          const id = p.get('id') ?? '';
          const user = p.get('user') ?? '';
          if (!safeEqual(p.get('state') ?? '', state)) {
            send(400, 'text/plain', 'State mismatch — this sign-in was not started by this terminal. Re-run `mieweb login`.');
            return;
          }
          if (!key || !id) {
            send(400, 'text/plain', 'The Manager did not return an API key.');
            return;
          }
          send(200, 'text/plain', 'ok');
          settle.resolve({ key, id, user });
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

  const timer = setTimeout(() => settle.reject(new Error('Timed out waiting for the browser sign-in')), timeoutMs);
  const onAbort = (): void => settle.reject(signal.reason);
  signal.addEventListener('abort', onAbort, { once: true });
  const close = (): void => {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
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
  const instanceUrl = await loginInstanceUrl(ctx, deps, hooks);
  if (deps.env.MIEWEB_OS_TOKEN?.trim()) {
    logger.warn('MIEWEB_OS_TOKEN is set in the environment and takes precedence over the login cache.');
  }

  // Fail fast (before opening a browser) if the instance isn't a Manager.
  const probe = new ManagerClient({ instanceUrl, token: null, target: ctx.target, signal: ctx.signal, fetch: deps.fetch });
  await probe.request<{ status: string }>('GET', '/health', { auth: false });

  const state = randomBytes(24).toString('base64url');
  const loop = await startLoopback(state, ctx.signal, hooks.timeoutMs ?? 5 * 60 * 1000);
  try {
    const params = new URLSearchParams({ port: String(loop.port), state, client: clientLabel() });
    const authUrl = `${instanceUrl}/api/v1/auth/cli/callback?${params.toString()}`;
    logger.info(`Opening your browser to sign in to ${instanceUrl}`);
    logger.info(`If it doesn't open, visit: ${authUrl}`);
    (hooks.openBrowser ?? defaultOpenBrowser)(authUrl);

    const handoff = await loop.result;

    const client = new ManagerClient({ instanceUrl, token: handoff.key, target: ctx.target, signal: ctx.signal, fetch: deps.fetch });
    const session = await client.get<SessionInfo>('/session');

    // Revoke the key this login replaces, so repeated logins don't pile up keys.
    const previous = await readCredential(deps.env, instanceUrl);
    await writeCredential(deps.env, instanceUrl, {
      token: handoff.key,
      apiKeyId: handoff.id,
      user: session.user,
      savedAt: new Date().toISOString(),
    });
    if (previous && previous.apiKeyId !== handoff.id) {
      await revoke(instanceUrl, previous.token, previous.apiKeyId, ctx, deps, logger);
    }
    logger.info(`Logged in to ${instanceUrl} as ${session.user}`);
  } finally {
    loop.close();
  }
}

async function revoke(
  instanceUrl: string,
  token: string,
  apiKeyId: string,
  ctx: DeployContext,
  deps: ProviderDeps,
  logger: DeployLogger,
): Promise<void> {
  const client = new ManagerClient({ instanceUrl, token, target: ctx.target, signal: ctx.signal, fetch: deps.fetch });
  try {
    await client.delete(`/apikeys/${encodeURIComponent(apiKeyId)}`);
  } catch (err) {
    const status = (err as { status?: number }).status;
    // Already gone or already invalid: nothing to revoke.
    if ((err as Error).name === 'AuthError' || status === 404) return;
    logger.warn(`Could not revoke API key ${apiKeyId} on ${instanceUrl}: ${(err as Error).message}`);
  }
}

export async function logout(ctx: DeployContext, deps: ProviderDeps): Promise<void> {
  const { logger } = ctx;
  const explicit = instanceFromArgv(ctx.argv) || deps.env.MIEWEB_OS_URL?.trim();
  const instanceUrl = explicit ? normalizeInstanceUrl(explicit) : resolveInstanceUrl(deps.env, ctx.targetConfig);
  if (deps.env.MIEWEB_OS_TOKEN?.trim()) {
    logger.warn('MIEWEB_OS_TOKEN is set in the environment; logout cannot clear it. Unset it to fully log out.');
  }
  const cred = await readCredential(deps.env, instanceUrl);
  if (!cred) {
    logger.info(`Not logged in to ${instanceUrl}`);
    return;
  }
  await revoke(instanceUrl, cred.token, cred.apiKeyId, ctx, deps, logger);
  await deleteCredential(deps.env, instanceUrl);
  logger.info(`Logged out of ${instanceUrl}`);
}
