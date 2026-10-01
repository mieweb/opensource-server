/**
 * SshConnection against an in-process ssh2 server: auth fallbacks, host-key
 * pinning, and exec with stdin.
 */

import { strict as assert } from 'node:assert';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { timingSafeEqual } from 'node:crypto';
import ssh2 from 'ssh2';
import type { AuthContext, Connection } from 'ssh2';
import { forgetHostKey, SshConnection, waitForSsh } from '../src/ssh.ts';

const { Server, utils } = ssh2;
const logger = { info() {}, warn() {}, error() {} };

interface ServerHandle {
  port: number;
  close: () => Promise<void>;
  authAttempts: string[];
}

function startServer(opts: { password?: string; publicKey?: Buffer; hostKey: string }): Promise<ServerHandle> {
  const authAttempts: string[] = [];
  const allowed = opts.publicKey ? utils.parseKey(opts.publicKey) : null;
  const server = new Server({ hostKeys: [opts.hostKey] }, (client: Connection) => {
    client.on('authentication', (ctx: AuthContext) => {
      authAttempts.push(ctx.method);
      if (ctx.method === 'password' && opts.password && ctx.password === opts.password) return ctx.accept();
      if (ctx.method === 'publickey' && allowed && !(allowed instanceof Error)) {
        const same =
          ctx.key.algo === allowed.type && timingSafeEqual(ctx.key.data, allowed.getPublicSSH());
        if (same && (!ctx.signature || allowed.verify(ctx.blob!, ctx.signature, ctx.hashAlgo))) return ctx.accept();
      }
      ctx.reject(['password', 'publickey']);
    });
    client.on('ready', () => {
      client.on('session', (accept) => {
        const session = accept();
        session.on('exec', (acceptExec, _reject, info) => {
          const stream = acceptExec();
          const chunks: Buffer[] = [];
          stream.on('data', (d: Buffer) => chunks.push(d));
          stream.on('end', () => {
            if (info.command === 'follow') {
              stream.write('a\n');
              stream.stderr.write('e\n');
              const t = setInterval(() => stream.write('tick\n'), 10);
              stream.on('close', () => clearInterval(t));
              return;
            }
            if (info.command === 'fail') {
              stream.stderr.write('boom');
              stream.exit(3);
            } else {
              stream.write(`${info.command}:${Buffer.concat(chunks).toString()}`);
              stream.exit(0);
            }
            stream.end();
          });
        });
      });
    });
    client.on('error', () => {});
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: (server.address() as { port: number }).port,
        authAttempts,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

let home: string;
const hostKeyA = utils.generateKeyPairSync('ed25519').private;
const hostKeyB = utils.generateKeyPairSync('ed25519').private;
const userKey = utils.generateKeyPairSync('ed25519');

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'os-ssh-'));
});
after(async () => {
  await rm(home, { recursive: true, force: true });
});

const signal = (): AbortSignal => AbortSignal.timeout(20_000);

describe('SshConnection', () => {
  test('password fallback via prompt (asked once), exec with stdin, host key pinned', async () => {
    const srv = await startServer({ password: 's3cret', hostKey: hostKeyA });
    const knownHostsFile = join(home, 'kh1');
    const prompts: string[] = [];
    const env = { HOME: join(home, 'nokeys'), SSH_AUTH_SOCK: '' };
    try {
      const conn = await SshConnection.connect({
        target: { host: '127.0.0.1', port: srv.port, user: 'alice' },
        env,
        knownHostsFile,
        interactive: true,
        prompt: async (q) => {
          prompts.push(q);
          return 's3cret';
        },
        signal: signal(),
        logger,
      });
      const res = await conn.exec('echo', Buffer.from('hello'));
      assert.equal(res.code, 0);
      assert.equal(res.stdout.toString(), 'echo:hello');
      const bad = await conn.exec('fail');
      assert.deepEqual([bad.code, bad.stderr], [3, 'boom']);
      conn.close();
      assert.deepEqual(prompts, [`alice@127.0.0.1:${srv.port}'s password: `]);
      assert.match(await readFile(knownHostsFile, 'utf8'), new RegExp(`^\\[127\\.0\\.0\\.1\\]:${srv.port} SHA256:\\S+\\n$`));
    } finally {
      await srv.close();
    }
  });

  test('uses ~/.ssh keys without prompting; non-interactive password auth is skipped', async () => {
    const keyHome = join(home, 'withkey');
    await mkdir(join(keyHome, '.ssh'), { recursive: true });
    await writeFile(join(keyHome, '.ssh', 'id_ed25519'), userKey.private);
    const srv = await startServer({ publicKey: Buffer.from(userKey.public), hostKey: hostKeyA });
    try {
      const conn = await SshConnection.connect({
        target: { host: '127.0.0.1', port: srv.port, user: 'alice' },
        env: { HOME: keyHome, SSH_AUTH_SOCK: '' },
        knownHostsFile: join(home, 'kh2'),
        interactive: false,
        prompt: async () => assert.fail('must not prompt'),
        signal: signal(),
        logger,
      });
      conn.close();
      assert.ok(srv.authAttempts.includes('publickey'));

      await assert.rejects(
        SshConnection.connect({
          target: { host: '127.0.0.1', port: srv.port, user: 'alice' },
          env: { HOME: join(home, 'nokeys'), SSH_AUTH_SOCK: '' },
          knownHostsFile: join(home, 'kh2'),
          interactive: false,
          signal: signal(),
          logger,
        }),
        /SSH authentication as alice@127\.0\.0\.1:\d+ failed/,
      );
    } finally {
      await srv.close();
    }
  });

  test('a changed host key is rejected until the pin is forgotten', async () => {
    const knownHostsFile = join(home, 'kh3');
    const opts = (port: number) => ({
      target: { host: '127.0.0.1', port, user: 'alice' },
      env: { HOME: join(home, 'nokeys'), SSH_AUTH_SOCK: '' },
      knownHostsFile,
      interactive: true,
      prompt: async () => 'pw',
      signal: signal(),
      logger,
    });
    const a = await startServer({ password: 'pw', hostKey: hostKeyA });
    const port = a.port;
    (await SshConnection.connect(opts(port))).close();
    await a.close();

    const b = await new Promise<ServerHandle>((resolve) => {
      const tryListen = async (): Promise<void> => {
        // Reuse the same port so the pin applies.
        const srv = new Server({ hostKeys: [hostKeyB] }, (c: Connection) => {
          c.on('authentication', (ctx: AuthContext) => (ctx.method === 'password' ? ctx.accept() : ctx.reject(['password'])));
          c.on('error', () => {});
        });
        srv.listen(port, '127.0.0.1', () =>
          resolve({ port, authAttempts: [], close: () => new Promise((r) => srv.close(() => r())) }),
        );
      };
      void tryListen();
    });
    try {
      await assert.rejects(SshConnection.connect(opts(port)), /host key for \[127\.0\.0\.1\]:\d+ changed/);
      await forgetHostKey(knownHostsFile, '127.0.0.1', port);
      (await SshConnection.connect(opts(port))).close();
    } finally {
      await b.close();
    }
  });

  test('stream delivers output and stops on abort', async () => {
    const srv = await startServer({ password: 'pw', hostKey: hostKeyA });
    try {
      const conn = await SshConnection.connect({
        target: { host: '127.0.0.1', port: srv.port, user: 'alice' },
        env: { HOME: join(home, 'nokeys'), SSH_AUTH_SOCK: '' },
        knownHostsFile: join(home, 'kh4'),
        interactive: true,
        prompt: async () => 'pw',
        signal: signal(),
        logger,
      });
      const ac = new AbortController();
      const seen: string[] = [];
      const code = await conn.stream(
        'follow',
        (d, w) => {
          seen.push(`${w}:${d.toString()}`);
          if (seen.filter((x) => x.includes('tick')).length >= 2) ac.abort();
        },
        ac.signal,
      );
      conn.close();
      assert.equal(code, -1);
      assert.ok(seen.includes('stdout:a\n'));
      assert.ok(seen.includes('stderr:e\n'));
    } finally {
      await srv.close();
    }
  });

  test('waitForSsh sees the banner', async () => {
    const srv = await startServer({ password: 'x', hostKey: hostKeyA });
    try {
      await waitForSsh('127.0.0.1', srv.port, signal(), logger, 5000);
    } finally {
      await srv.close();
    }
  });
});
