import { strict as assert } from 'node:assert';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, beforeEach, describe, test } from 'node:test';
import { AuthError } from '@mieweb/deploy-contract';
import type { DeployContext, ProviderEnv, ResourceHandle } from '@mieweb/deploy-contract';
import { runProviderConformance } from '@mieweb/deploy-contract/testkit';
import { createProvider, type ProviderOptions } from '../src/index.ts';
import type { SshTarget } from '../src/ssh.ts';
import { FakeManager } from './fake-manager.ts';
import { FakeShell } from './fake-shell.ts';

const TOKEN = 'test-token';

let fake: FakeManager;
let dir: string;
/** The app worktree deployed by the tests, and the fake container's /opt/app/src. */
let appRoot: string;
let remoteDir: string;
/** SSH sessions the provider opened, and SSH readiness waits. */
let sessions: { target: SshTarget; shell: FakeShell }[];
let sshWaits: string[];
let connectError: Error | null;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'os-cloud-provider-'));
});
after(async () => {
  await rm(dir, { recursive: true, force: true });
});
beforeEach(async () => {
  fake = await new FakeManager().start();
  fake.addToken(TOKEN);
  appRoot = await mkdtemp(join(dir, 'app-'));
  remoteDir = await mkdtemp(join(dir, 'remote-'));
  await writeFile(join(appRoot, 'package.json'), '{"name":"myapp"}');
  await writeFile(join(appRoot, '.gitignore'), 'node_modules/\n');
  sessions = [];
  sshWaits = [];
  connectError = null;
});
afterEach(async () => {
  await fake.stop();
});

interface Harness {
  ctx: DeployContext;
  logs: string[];
  abort: AbortController;
}

function harness(opts: { manifest?: Record<string, unknown>; targetConfig?: Record<string, unknown>; argv?: string[] } = {}): Harness {
  const logs: string[] = [];
  const abort = new AbortController();
  return {
    logs,
    abort,
    ctx: {
      root: appRoot,
      target: 'mieweb',
      manifest: opts.manifest ?? { name: 'myapp', vars: { GREETING: 'hi' } },
      mieweb: {},
      targetConfig: opts.targetConfig ?? { siteId: 1 },
      argv: opts.argv ?? [],
      logger: {
        info: (m) => logs.push(`info:${m}`),
        warn: (m) => logs.push(`warn:${m}`),
        error: (m) => logs.push(`error:${m}`),
      },
      signal: abort.signal,
    },
  };
}

function provider(env: ProviderEnv = {}, options: ProviderOptions = {}) {
  return createProvider(
    { HOME: dir, MIEWEB_OS_URL: fake.url, MIEWEB_OS_TOKEN: TOKEN, MIEWEB_OS_CREDENTIALS: join(dir, `creds-${Math.random()}.json`), ...env },
    {
      pollIntervalMs: 5,
      connectSsh: async (target) => {
        if (connectError) throw connectError;
        const shell = new FakeShell(remoteDir);
        sessions.push({ target, shell });
        return shell;
      },
      waitForSsh: async (host, port) => {
        sshWaits.push(`${host}:${port}`);
      },
      ...options,
    },
  );
}

describe('contract', () => {
  test('passes structural conformance', async () => {
    const report = await runProviderConformance(provider(), { target: 'mieweb', manifest: { name: 'myapp' } });
    assert.deepEqual(report.failures, []);
  });

  test('passes live conformance (handle stability) against the fake Manager', async () => {
    const report = await runProviderConformance(provider(), {
      target: 'mieweb',
      manifest: { name: 'myapp' },
      targetConfig: { siteId: 1 },
      root: dir,
      live: true,
      // Identity is the hostname, which is already in the manifest.
      applyIds: (m: Readonly<Record<string, unknown>>, _r: readonly ResourceHandle[]) => ({ ...m }),
    });
    assert.deepEqual(report.failures, []);
    assert.equal(fake.containers.length, 1);
  });

  test('supports only the mieweb target; dev and tail are omitted', () => {
    const p = provider();
    assert.equal(p.name, 'opensource-server');
    assert.equal(p.supports('mieweb'), true);
    assert.equal(p.supports('cloudflare'), false);
    assert.equal(p.dev, undefined);
    assert.equal(p.tail, undefined);
  });
});

describe('deploy', () => {
  test('creates the container with http + ssh services, env, and the data volume', async () => {
    await mkdir(join(dir, '.mieweb'), { recursive: true });
    await writeFile(join(dir, '.mieweb', 'known_hosts'), '[ssh.example.test]:2000 SHA256:stale\n[other]:22 SHA256:keep\n');
    const h = harness();
    const result = await provider({ MIEWEB_OS_SECRET_API_KEY: 'k' }).deploy(h.ctx);

    assert.equal(fake.containers.length, 1);
    const c = fake.containers[0]!;
    assert.equal(c.hostname, 'myapp');
    assert.equal(c.template, 'ghcr.io/mieweb/opensource-server/cloud:latest');
    assert.deepEqual(c.volumes.map(({ name, mountPath, mode }) => ({ name, mountPath, mode })), [
      { name: 'data', mountPath: '/mnt/data', mode: 'rw' },
    ]);
    assert.equal(c.services.length, 2);
    assert.deepEqual(
      c.services.filter((x) => x.type === 'transport').map((x) => [x.internalPort, x.transportService!.protocol]),
      [[22, 'tcp']],
    );
    assert.deepEqual(c.services[0]!.httpService, {
      externalHostname: 'myapp',
      externalDomainId: 7,
      backendProtocol: 'http',
      authRequired: false,
    });
    assert.equal(c.services[0]!.internalPort, 8787);
    assert.equal(c.environmentVars.GREETING, 'hi');
    assert.equal(c.environmentVars.API_KEY, 'k');
    assert.equal(c.environmentVars.MIEWEB_APP_SOURCE, undefined);

    // id is the hypervisor VMID read back after the job, not the DB id.
    assert.deepEqual(result, {
      url: 'https://myapp.apps.example.test',
      resources: [{ binding: 'myapp', kind: 'container', id: c.containerId }],
    });
    assert.notEqual(c.containerId, String(c.id));
    assert.ok(h.logs.some((l) => l.includes('[job ')), 'job output is forwarded to the logger');
    assert.ok(!fake.requests.some((r) => r.path.startsWith('/jobs/') && r.path.endsWith('/stream')));

    // Fresh container: forget the stale host key, wait for SSH, sync, restart.
    const sshPort = c.services.find((x) => x.internalPort === 22)!.transportService!.externalPort;
    assert.equal(sshPort, 2000);
    assert.equal(await readFile(join(dir, '.mieweb', 'known_hosts'), 'utf8'), '[other]:22 SHA256:keep\n');
    assert.deepEqual(sshWaits, [`ssh.example.test:${sshPort}`]);
    assert.equal(sessions.length, 1);
    assert.deepEqual(sessions[0]!.target, { host: 'ssh.example.test', port: sshPort, user: 'alice' }, 'ssh user = Manager account');
    assert.equal(await readFile(join(remoteDir, 'package.json'), 'utf8'), '{"name":"myapp"}');
    assert.match(sessions[0]!.shell.commands.at(-1)!, /systemctl restart app\.service/);
    assert.equal(sessions[0]!.shell.closed, true);
  });

  test('redeploy with no config change only syncs code (no Manager writes)', async () => {
    const p = provider();
    const first = await p.deploy(harness().ctx);
    const writes = fake.requests.filter((r) => r.method !== 'GET').length;
    await writeFile(join(appRoot, 'new.js'), 'x');

    const h = harness();
    const second = await p.deploy(h.ctx);
    assert.deepEqual(second, first);
    assert.equal(fake.requests.filter((r) => r.method !== 'GET').length, writes);
    assert.equal(sessions.length, 2);
    assert.equal(await readFile(join(remoteDir, 'new.js'), 'utf8'), 'x');
    assert.ok(h.logs.some((l) => l.includes('configuration is up to date')));
  });

  test('sync user / host overrides and sync: false', async () => {
    const p = provider({ MIEWEB_OS_SSH_USER: 'root' });
    await p.deploy(harness({ targetConfig: { siteId: 1, sshHost: '10.0.0.5' } }).ctx);
    assert.deepEqual(sessions[0]!.target, { host: '10.0.0.5', port: 2000, user: 'root' });

    const h = harness({ targetConfig: { siteId: 1, sync: false } });
    await p.deploy(h.ctx);
    assert.equal(sessions.length, 1);
    assert.ok(h.logs.some((l) => l.includes('sync disabled')));
  });

  test('an SSH failure fails the deploy', async () => {
    connectError = new Error('SSH authentication as alice@ssh.example.test:2000 failed.');
    await assert.rejects(provider().deploy(harness().ctx), /SSH authentication as alice/);
  });

  test('old source/ref settings are rejected with an explanation', async () => {
    await assert.rejects(
      provider().deploy(harness({ targetConfig: { siteId: 1, source: 'https://x/y' } }).ctx),
      /syncs your local worktree/,
    );
  });

  test('redeploy with the same image updates in place and keeps the MinIO secret', async () => {
    const p = provider();
    const first = await p.deploy(harness().ctx);
    const pw = fake.containers[0]!.environmentVars.MINIO_ROOT_PASSWORD;

    const h = harness({
      manifest: { name: 'myapp', vars: { GREETING: 'hello' } },
      targetConfig: { siteId: 1, authRequired: true },
    });
    const second = await p.deploy(h.ctx);

    assert.deepEqual(second, first);
    assert.equal(fake.containers.length, 1);
    const c = fake.containers[0]!;
    assert.equal(c.environmentVars.MINIO_ROOT_PASSWORD, pw);
    assert.equal(c.environmentVars.GREETING, 'hello');
    assert.equal(c.services.length, 2);
    assert.equal(c.services.find((x) => x.type === 'http')!.httpService!.authRequired, true);
    const put = fake.requests.find((r) => r.method === 'PUT')!;
    assert.equal(put.body.restart, true);
    assert.equal(put.body.volumes, undefined, 'volume already attached');
    assert.ok(!fake.requests.some((r) => r.method === 'DELETE'));
  });

  test('changing the port replaces the http service', async () => {
    const p = provider();
    await p.deploy(harness().ctx);
    const oldId = fake.containers[0]!.services[0]!.id;
    await p.deploy(harness({ targetConfig: { siteId: 1, port: 3000 } }).ctx);
    const svcs = fake.containers[0]!.services.filter((x) => x.type === 'http');
    assert.equal(svcs.length, 1);
    assert.notEqual(svcs[0]!.id, oldId);
    assert.equal(svcs[0]!.internalPort, 3000);
  });

  test('an existing container without the data volume gets it attached', async () => {
    fake.seedContainer({ hostname: 'myapp' });
    await provider().deploy(harness().ctx);
    const put = fake.requests.find((r) => r.method === 'PUT')!;
    assert.deepEqual(put.body.volumes, [{ name: 'data', mountPath: '/mnt/data', mode: 'rw' }]);
  });

  test('image change → delete + recreate, carrying the MinIO secret', async () => {
    fake.seedContainer({
      hostname: 'myapp',
      template: 'ghcr.io/mieweb/opensource-server/cloud:old',
      environmentVars: { MINIO_ROOT_USER: 'mieweb', MINIO_ROOT_PASSWORD: 'persisted' },
      volumes: [{ id: 1, name: 'data', mountPath: '/mnt/data', mode: 'rw' }],
    });
    const h = harness({ targetConfig: { siteId: 1, image: 'ghcr.io/mieweb/opensource-server/cloud:sha-new' } });
    await provider().deploy(h.ctx);
    const methods = fake.requests.filter((r) => r.method !== 'GET').map((r) => r.method);
    assert.deepEqual(methods, ['DELETE', 'POST']);
    const c = fake.containers[0]!;
    assert.equal(c.template, 'ghcr.io/mieweb/opensource-server/cloud:sha-new');
    assert.equal(c.environmentVars.MINIO_ROOT_PASSWORD, 'persisted');
    assert.ok(h.logs.some((l) => l.includes('Recreating')));
  });

  test('a container whose create failed is recreated, not updated', async () => {
    fake.seedContainer({ hostname: 'myapp', containerId: null, status: 'failed' });
    const h = harness();
    const result = await provider().deploy(h.ctx);
    const methods = fake.requests.filter((r) => r.method !== 'GET').map((r) => r.method);
    assert.deepEqual(methods, ['DELETE', 'POST']);
    assert.equal(result.resources[0]!.id, fake.containers[0]!.containerId);
    assert.ok(h.logs.some((l) => l.includes('not provisioned (status failed)')));
  });

  test('AI binding requests a GPU only when the site has one; nvidia drift recreates', async () => {
    fake.nvidiaAvailable = true;
    fake.seedContainer({ hostname: 'myapp' });
    await provider().deploy(harness({ manifest: { name: 'myapp', ai: { binding: 'AI' } } }).ctx);
    assert.equal(fake.containers[0]!.nvidiaRequested, true);
    assert.ok(fake.requests.some((r) => r.method === 'DELETE'));
  });

  test('a lost create race (409 conflict) is converged with an update', async () => {
    fake.beforeCreate = (hostname) => {
      fake.beforeCreate = undefined;
      fake.seedContainer({ hostname });
    };
    await provider().deploy(harness().ctx);
    assert.equal(fake.containers.length, 1);
    assert.ok(fake.requests.some((r) => r.method === 'PUT'));
  });

  test('a hostname owned by someone else is a clear error', async () => {
    fake.seedContainer({ hostname: 'myapp', owner: 'bob' });
    await assert.rejects(provider().deploy(harness().ctx), /already taken on site 1/);
  });

  test('dropped connections while polling are retried', async () => {
    fake.dropJobPolls = 2;
    const result = await provider().deploy(harness().ctx);
    assert.equal(result.resources.length, 1);
    assert.equal(fake.dropJobPolls, 0);
  });

  test('a Manager without volume support: warn, and redeploys stay sync-only', async () => {
    fake.noVolumes = true;
    const p = provider();
    await p.deploy(harness().ctx);
    const writes = fake.requests.filter((r) => r.method !== 'GET').length;
    const h = harness();
    await p.deploy(h.ctx);
    assert.equal(fake.requests.filter((r) => r.method !== 'GET').length, writes, 'no PUT/restart');
    assert.ok(h.logs.some((l) => l.startsWith('warn:This Manager does not support volumes')));
    assert.equal(sessions.length, 2);
  });

  test('a failed job fails the deploy with its output', async () => {
    fake.jobOutcome = 'failure';
    await assert.rejects(provider().deploy(harness().ctx), /job \d+ ended with status "failure":\nstarting\ndone/);
  });

  test('abort cancels job polling', async () => {
    let release!: () => void;
    fake.jobGate = new Promise((r) => (release = r));
    const h = harness();
    const run = provider().deploy(h.ctx);
    setTimeout(() => h.abort.abort(new Error('user cancelled')), 50);
    await assert.rejects(run, /user cancelled/);
    release();
  });

  test('config errors are reported before any request', async () => {
    await assert.rejects(provider().deploy(harness({ targetConfig: {} }).ctx), /siteId is required/);
    await assert.rejects(provider().deploy(harness({ manifest: { name: 'Bad_Name' } }).ctx), /DNS label/);
    await assert.rejects(provider().deploy(harness({ targetConfig: { siteId: 1, domain: 'nope.test' } }).ctx), /not available/);
    assert.ok(fake.requests.every((r) => r.method === 'GET'));
  });

  test('401 → AuthError with a login hint; no token → AuthError without a request', async () => {
    const bad = provider({ MIEWEB_OS_TOKEN: 'wrong' });
    await assert.rejects(bad.deploy(harness().ctx), (err: unknown) => {
      assert.ok(err instanceof AuthError);
      assert.match((err as AuthError).hint ?? '', /MIEWEB_OS_TOKEN/);
      return true;
    });
    const before = fake.requests.length;
    await assert.rejects(provider({ MIEWEB_OS_TOKEN: '' }).deploy(harness().ctx), AuthError);
    assert.equal(fake.requests.length, before);
  });

  test('never reads secrets from targetConfig', async () => {
    const h = harness({ targetConfig: { siteId: 1, token: TOKEN, apiKey: TOKEN } });
    await assert.rejects(provider({ MIEWEB_OS_TOKEN: '' }).deploy(h.ctx), AuthError);
  });
});

describe('destroy', () => {
  test('deletes by hostname; no-op when absent', async () => {
    const p = provider();
    await p.deploy(harness().ctx);
    const h = harness();
    await p.destroy!(h.ctx);
    assert.equal(fake.containers.length, 0);
    assert.ok(h.logs.some((l) => l.includes('retained')));

    const h2 = harness();
    await p.destroy!(h2.ctx);
    assert.ok(h2.logs.some((l) => l.includes('nothing to destroy')));
  });
});

describe('whoami', () => {
  test('env token', async () => {
    assert.deepEqual(await provider().whoami!(harness().ctx), { authenticated: true, account: 'alice', method: 'env' });
  });
  test('bad token / no token', async () => {
    assert.deepEqual(await provider({ MIEWEB_OS_TOKEN: 'nope' }).whoami!(harness().ctx), { authenticated: false, method: 'env' });
    assert.deepEqual(await provider({ MIEWEB_OS_TOKEN: '' }).whoami!(harness().ctx), { authenticated: false });
  });
});

describe('login / logout', () => {
  /** Plays the browser: follow the Manager redirect, load the loopback page, post the fragment. */
  async function browser(url: string): Promise<void> {
    const res = await fetch(url, { redirect: 'manual' });
    const loc = new URL(res.headers.get('location')!);
    const page = await fetch(`${loc.origin}${loc.pathname}`);
    assert.match(await page.text(), /Finishing sign-in/);
    const post = await fetch(`${loc.origin}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', Origin: loc.origin },
      body: loc.hash.slice(1),
    });
    assert.equal(post.status, 200);
  }

  test('loopback handoff stores the key per instance; whoami uses it; logout revokes it', async () => {
    const creds = join(dir, 'login-creds.json');
    const env = { MIEWEB_OS_TOKEN: '', MIEWEB_OS_CREDENTIALS: creds };
    let opened = '';
    const p = provider(env, {
      login: {
        openBrowser: (u) => {
          opened = u;
          void browser(u);
        },
      },
    });

    const h = harness({ argv: ['--instance', `${fake.url}/`] });
    await p.login!(h.ctx);
    const q = new URL(opened).searchParams;
    assert.equal(new URL(opened).pathname, '/api/v1/auth/cli/callback');
    assert.match(q.get('state')!, /^[A-Za-z0-9_-]{32}$/);
    assert.match(q.get('client')!, /^mieweb-cli@/);

    const stored = JSON.parse(await readFile(creds, 'utf8'));
    assert.deepEqual(Object.keys(stored.instances), [fake.url]);
    assert.equal(stored.instances[fake.url].token, 'minted-key');
    assert.equal(stored.instances[fake.url].apiKeyId, 'key-2');
    assert.equal((await stat(creds)).mode & 0o777, 0o600);

    assert.deepEqual(await p.whoami!(harness().ctx), { authenticated: true, account: 'alice', method: 'login' });

    // Logging in again revokes the key it replaces.
    fake.nextKey = { key: 'minted-key-2', id: 'key-3', user: 'alice' };
    await p.login!(h.ctx);
    assert.equal(fake.tokens.has('minted-key'), false);

    await p.logout!(harness().ctx);
    assert.equal(fake.tokens.has('minted-key-2'), false, 'key revoked server-side');
    assert.deepEqual(JSON.parse(await readFile(creds, 'utf8')).instances, {});
    assert.deepEqual(await p.whoami!(harness().ctx), { authenticated: false });
  });

  test('a handoff with the wrong state is rejected', async () => {
    const env = { MIEWEB_OS_TOKEN: '', MIEWEB_OS_CREDENTIALS: join(dir, 'state-creds.json') };
    let status = 0;
    const p = provider(env, {
      login: {
        timeoutMs: 300,
        openBrowser: (u) => {
          const port = new URL(u).searchParams.get('port');
          void fetch(`http://127.0.0.1:${port}/token`, { method: 'POST', body: 'key=k&id=i&state=forged' }).then(
            (r) => (status = r.status),
          );
        },
      },
    });
    await assert.rejects(p.login!(harness().ctx), /Timed out/);
    assert.equal(status, 400);
  });

  test('logout warns that an env token cannot be cleared', async () => {
    const h = harness();
    await provider({ MIEWEB_OS_CREDENTIALS: join(dir, 'none.json') }).logout!(h.ctx);
    assert.ok(h.logs.some((l) => l.startsWith('warn:MIEWEB_OS_TOKEN')));
    assert.ok(h.logs.some((l) => l.includes('Not logged in')));
  });
});
