/**
 * Pure-JS SSH (the `ssh2` package): no `ssh`/`rsync` binaries needed.
 *
 * Authentication uses the user's own local credentials, in order:
 *   1. ssh-agent (`SSH_AUTH_SOCK`; Pageant on Windows)
 *   2. default keys in ~/.ssh (id_ed25519, id_ecdsa, id_rsa), prompting for a
 *      passphrase on the terminal when a key is encrypted
 *   3. keyboard-interactive / password, prompted on the terminal
 * Prompts go to stderr and only happen when stdin is a TTY.
 *
 * Host keys are pinned trust-on-first-use in ~/.mieweb/known_hosts
 * (`[host]:port SHA256:<fingerprint>`). A changed key is an error unless the
 * caller cleared the pin first (it does after recreating the container).
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { connect as netConnect } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { DeployLogger, ProviderEnv } from '@mieweb/deploy-contract';
import ssh2 from 'ssh2';
import type { AnyAuthMethod, AuthenticationType, ClientChannel, ConnectConfig, Prompt } from 'ssh2';
import { sleep } from './jobs.ts';

const { Client, utils } = ssh2;

export interface SshTarget {
  host: string;
  port: number;
  user: string;
}

export interface ExecResult {
  code: number;
  stdout: Buffer;
  stderr: string;
}

/** The remote operations sync needs. `SshConnection` implements it over ssh2. */
export interface RemoteShell {
  exec(command: string, stdin?: Buffer | NodeJS.ReadableStream): Promise<ExecResult>;
  close(): void;
}

/** Terminal prompt; `hidden` suppresses echo. Returns null when not interactive. */
export type Prompter = (question: string, hidden: boolean) => Promise<string | null>;

export const ttyPrompter: Prompter = (question, hidden) =>
  new Promise((resolve) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      resolve(null);
      return;
    }
    process.stderr.write(question);
    let answer = '';
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (chunk: string): void => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          done(answer);
          return;
        }
        if (ch === '\u0003') {
          done(null);
          return;
        }
        if (ch === '\u007f' || ch === '\b') {
          if (answer.length > 0) {
            answer = answer.slice(0, -1);
            if (!hidden) process.stderr.write('\b \b');
          }
          continue;
        }
        answer += ch;
        if (!hidden) process.stderr.write(ch);
      }
    };
    const done = (value: string | null): void => {
      stdin.off('data', onData);
      stdin.setRawMode(wasRaw);
      stdin.pause();
      process.stderr.write('\n');
      resolve(value);
    };
    stdin.on('data', onData);
  });

// --- known hosts ------------------------------------------------------------

export function knownHostsPath(env: ProviderEnv): string {
  return join(env.HOME?.trim() || homedir(), '.mieweb', 'known_hosts');
}

function hostKeyId(host: string, port: number): string {
  return `[${host}]:${port}`;
}

export function fingerprint(key: Buffer): string {
  return `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;
}

function readKnownHosts(file: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!existsSync(file)) return map;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const [id, fp] = line.trim().split(/\s+/);
    if (id && fp) map.set(id, fp);
  }
  return map;
}

async function writeKnownHosts(file: string, map: Map<string, string>): Promise<void> {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, [...map].map(([id, fp]) => `${id} ${fp}\n`).join(''), { mode: 0o600 });
}

/** Drop the pinned key for host:port (the container behind it was replaced). */
export async function forgetHostKey(file: string, host: string, port: number): Promise<void> {
  const map = readKnownHosts(file);
  if (map.delete(hostKeyId(host, port))) await writeKnownHosts(file, map);
}

// --- auth -------------------------------------------------------------------

const DEFAULT_KEYS = ['id_ed25519', 'id_ecdsa', 'id_rsa'];

interface KeyCandidate {
  path: string;
  data: Buffer;
  encrypted: boolean;
}

function localKeys(env: ProviderEnv): KeyCandidate[] {
  const dir = join(env.HOME?.trim() || homedir(), '.ssh');
  const out: KeyCandidate[] = [];
  for (const name of DEFAULT_KEYS) {
    const path = join(dir, name);
    let data: Buffer;
    try {
      data = readFileSync(path);
    } catch {
      continue;
    }
    const parsed = utils.parseKey(data);
    if (parsed instanceof Error) {
      if (/encrypted|passphrase/i.test(parsed.message)) out.push({ path, data, encrypted: true });
      continue;
    }
    out.push({ path, data, encrypted: false });
  }
  return out;
}

/**
 * Build the ssh2 authHandler. Methods are tried in order; ones the server
 * doesn't offer are skipped. The password is asked for at most once and
 * reused for keyboard-interactive.
 */
export function makeAuthHandler(
  user: string,
  env: ProviderEnv,
  prompt: Prompter,
  target: string,
  interactive: boolean = !!process.stdin.isTTY,
) {
  let password: string | null | undefined;
  const askPassword = async (): Promise<string | null> => {
    if (password === undefined) password = await prompt(`${user}@${target}'s password: `, true);
    return password;
  };

  type Step = () => Promise<AnyAuthMethod | null>;
  const steps: { type: AuthenticationType; step: Step }[] = [];

  const agent = env.SSH_AUTH_SOCK?.trim() || (process.platform === 'win32' ? 'pageant' : '');
  if (agent) steps.push({ type: 'publickey', step: async () => ({ type: 'agent', username: user, agent }) });

  for (const key of localKeys(env)) {
    steps.push({
      type: 'publickey',
      step: async () => {
        if (!key.encrypted) return { type: 'publickey', username: user, key: key.data };
        if (!interactive) return null;
        const passphrase = await prompt(`Enter passphrase for key '${key.path}': `, true);
        if (!passphrase) return null;
        if (utils.parseKey(key.data, passphrase) instanceof Error) return null;
        return { type: 'publickey', username: user, key: key.data, passphrase };
      },
    });
  }

  steps.push({
    type: 'keyboard-interactive',
    step: async () => (!interactive ? null : {
      type: 'keyboard-interactive',
      username: user,
      prompt: (_name: string, _instr: string, _lang: string, prompts: Prompt[], finish: (answers: string[]) => void) => {
        void (async () => {
          const answers: string[] = [];
          for (const p of prompts) {
            const isPassword = /password/i.test(p.prompt) && !p.echo;
            const answer = isPassword ? await askPassword() : await prompt(p.prompt, !p.echo);
            answers.push(answer ?? '');
          }
          finish(answers);
        })();
      },
    }),
  });
  steps.push({
    type: 'password',
    step: async () => {
      if (!interactive) return null;
      const pw = await askPassword();
      return pw === null ? null : { type: 'password', username: user, password: pw };
    },
  });

  let i = 0;
  return (authsLeft: AuthenticationType[] | null, _partial: boolean, next: (m: AnyAuthMethod | false) => void): void => {
    void (async () => {
      while (i < steps.length) {
        const s = steps[i++]!;
        if (authsLeft && !authsLeft.includes(s.type)) continue;
        const method = await s.step();
        if (method) {
          next(method);
          return;
        }
      }
      next(false);
    })();
  };
}

// --- connection -------------------------------------------------------------

export interface ConnectOptions {
  target: SshTarget;
  env: ProviderEnv;
  knownHostsFile: string;
  prompt?: Prompter;
  /** Whether prompting is possible (default: stdin is a TTY). */
  interactive?: boolean;
  signal: AbortSignal;
  logger: DeployLogger;
  timeoutMs?: number;
}

export class SshConnection implements RemoteShell {
  private readonly client: InstanceType<typeof Client>;
  private constructor(client: InstanceType<typeof Client>) {
    this.client = client;
  }

  static connect(opts: ConnectOptions): Promise<SshConnection> {
    const { target, logger } = opts;
    const id = hostKeyId(target.host, target.port);
    const known = readKnownHosts(opts.knownHostsFile);
    let pinned: { fp: string } | null = null;
    let mismatch: string | null = null;

    return new Promise((resolve, reject) => {
      const client = new Client();
      const onAbort = (): void => {
        client.end();
        reject(opts.signal.reason);
      };
      opts.signal.addEventListener('abort', onAbort, { once: true });
      const fail = (err: Error): void => {
        opts.signal.removeEventListener('abort', onAbort);
        if (mismatch) {
          reject(
            new Error(
              `SSH host key for ${id} changed (expected ${known.get(id)}, got ${mismatch}). ` +
                `If the container was rebuilt, remove that line from ${opts.knownHostsFile}.`,
            ),
          );
        } else if (/authentication methods failed/i.test(err.message)) {
          reject(
            new Error(
              `SSH authentication as ${target.user}@${target.host}:${target.port} failed. ` +
                'Add your public key to your account, load it into ssh-agent, or run deploy in a terminal to enter your password.',
            ),
          );
        } else reject(new Error(`SSH connection to ${target.host}:${target.port} failed: ${err.message}`, { cause: err }));
      };
      client.once('error', fail);
      client.once('ready', () => {
        opts.signal.removeEventListener('abort', onAbort);
        client.off('error', fail);
        client.on('error', () => {});
        const done = (): void => resolve(new SshConnection(client));
        if (pinned) {
          known.set(id, pinned.fp);
          logger.info(`Trusting SSH host key ${pinned.fp} for ${id}`);
          writeKnownHosts(opts.knownHostsFile, known).then(done, done);
        } else done();
      });

      const config: ConnectConfig = {
        host: target.host,
        port: target.port,
        username: target.user,
        readyTimeout: opts.timeoutMs ?? 20_000,
        keepaliveInterval: 15_000,
        hostVerifier: (key: Buffer) => {
          const fp = fingerprint(key);
          const expected = known.get(id);
          if (!expected) {
            pinned = { fp };
            return true;
          }
          if (expected === fp) return true;
          mismatch = fp;
          return false;
        },
        authHandler: makeAuthHandler(
          target.user,
          opts.env,
          opts.prompt ?? ttyPrompter,
          `${target.host}:${target.port}`,
          opts.interactive ?? !!process.stdin.isTTY,
        ) as ConnectConfig['authHandler'],
      };
      client.connect(config);
    });
  }

  exec(command: string, stdin?: Buffer | NodeJS.ReadableStream): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
      this.client.exec(command, (err: Error | undefined, stream: ClientChannel) => {
        if (err) {
          reject(err);
          return;
        }
        const out: Buffer[] = [];
        let stderr = '';
        let code = -1;
        stream.on('data', (d: Buffer) => out.push(d));
        stream.stderr.on('data', (d: Buffer) => {
          stderr = (stderr + d.toString('utf8')).slice(-8192);
        });
        stream.on('exit', (c: number | null) => {
          code = c ?? -1;
        });
        stream.on('close', () => resolve({ code, stdout: Buffer.concat(out), stderr }));
        stream.on('error', reject);
        if (stdin === undefined) stream.end();
        else if (Buffer.isBuffer(stdin)) stream.end(stdin);
        else {
          stdin.on('error', () => stream.close());
          stdin.pipe(stream);
        }
      });
    });
  }

  close(): void {
    this.client.end();
  }
}

// --- readiness --------------------------------------------------------------

/** Resolve once host:port answers with an SSH banner. */
export async function waitForSsh(
  host: string,
  port: number,
  signal: AbortSignal,
  logger: DeployLogger,
  timeoutMs = 5 * 60 * 1000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let announced = false;
  for (;;) {
    if (await probeSsh(host, port, signal)) return;
    if (!announced) {
      logger.info(`Waiting for SSH on ${host}:${port}…`);
      announced = true;
    }
    if (Date.now() > deadline) {
      throw new Error(`SSH on ${host}:${port} did not become available within ${Math.round(timeoutMs / 1000)}s`);
    }
    await sleep(2000, signal);
  }
}

function probeSsh(host: string, port: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = netConnect({ host, port, timeout: 5000 });
    let buf = '';
    const done = (ok: boolean): void => {
      signal.removeEventListener('abort', onAbort);
      sock.destroy();
      resolve(ok);
    };
    const onAbort = (): void => done(false);
    signal.addEventListener('abort', onAbort, { once: true });
    sock.setEncoding('latin1');
    sock.on('data', (d: string) => {
      buf += d;
      if (buf.includes('\n') || buf.length >= 4) done(buf.startsWith('SSH-'));
    });
    sock.on('timeout', () => done(false));
    sock.on('error', () => done(false));
    sock.on('end', () => done(false));
  });
}
