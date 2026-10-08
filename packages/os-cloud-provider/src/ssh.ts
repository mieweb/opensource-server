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
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { DeployLogger, ProviderEnv } from '@mieweb/deploy-contract';
import ssh2 from 'ssh2';
import type { AnyAuthMethod, AuthenticationType, ClientChannel, ConnectConfig, Prompt } from 'ssh2';
import { updateLockedFile } from './locked-file.ts';
import { ttyPrompter, type Prompter } from './prompt.ts';

const { Client, utils } = ssh2;

export interface SshTarget {
  host: string;
  port: number;
  user: string;
}

/**
 * A failed SSH connection attempt. `kind` tells callers whether a retry can
 * help: `network` (refused/reset/timeout, e.g. sshd still starting) and `auth`
 * (possibly LDAP keys not served yet on a fresh container) may be transient;
 * `hostkey` never is.
 */
export class SshError extends Error {
  readonly kind: 'network' | 'auth' | 'hostkey';
  constructor(kind: 'network' | 'auth' | 'hostkey', message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SshError';
    this.kind = kind;
  }
}

export interface ExecResult {
  code: number;
  stdout: Buffer;
  stderr: string;
}

/** The remote operations sync needs. `SshConnection` implements it over ssh2. */
export interface RemoteShell {
  /** Run a command to completion. On abort the channel is closed and the promise rejects with the signal's reason. */
  exec(command: string, stdin?: Buffer | NodeJS.ReadableStream, signal?: AbortSignal): Promise<ExecResult>;
  /**
   * Run a long-lived command, calling `onData` with stdout/stderr chunks.
   * Resolves with the exit code, or -1 when `signal` aborts (the channel is
   * closed).
   */
  stream(command: string, onData: (chunk: Buffer, stream: 'stdout' | 'stderr') => void, signal: AbortSignal): Promise<number>;
  /**
   * Run `command` and keep its channel open until `release()`; resolves once
   * stdout contains `ready`. If the command exits first, rejects with its
   * exit code and stderr. Used to hold a remote lock (e.g. `flock ... cat`):
   * closing the channel, or losing the connection, ends it.
   */
  hold(command: string, ready: string, signal: AbortSignal): Promise<{ release(): void }>;
  close(): void;
}

export type { Prompter } from './prompt.ts';

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

function parseKnownHosts(text: string | null): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of (text ?? '').split('\n')) {
    const [id, fp] = line.trim().split(/\s+/);
    if (id && fp) map.set(id, fp);
  }
  return map;
}

function serializeKnownHosts(map: Map<string, string>): string {
  return [...map].map(([id, fp]) => `${id} ${fp}\n`).join('');
}

function readKnownHosts(file: string): Map<string, string> {
  return parseKnownHosts(existsSync(file) ? readFileSync(file, 'utf8') : null);
}

/**
 * Pin `fp` for `id`, merged into the file's current contents under a lock (so
 * parallel deploys don't overwrite each other's pins). Throws if another
 * process pinned a different key for `id` in the meantime.
 */
export async function pinHostKey(file: string, id: string, fp: string): Promise<void> {
  let conflict: string | undefined;
  await updateLockedFile(file, (text) => {
    const map = parseKnownHosts(text);
    const existing = map.get(id);
    if (existing === fp) return null;
    if (existing) {
      conflict = existing;
      return null;
    }
    map.set(id, fp);
    return serializeKnownHosts(map);
  });
  if (conflict) throw new Error(`a different key (${conflict}) was pinned for ${id} concurrently`);
}

/** Drop the pinned key for host:port (the container behind it was replaced). */
export async function forgetHostKey(file: string, host: string, port: number): Promise<void> {
  await updateLockedFile(file, (text) => {
    const map = parseKnownHosts(text);
    return map.delete(hostKeyId(host, port)) ? serializeKnownHosts(map) : null;
  });
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
      if (opts.signal.aborted) {
        onAbort();
        return;
      }
      let settled = false;
      const fail = (err: Error): void => {
        // ssh2 can emit several errors for one failed handshake (e.g. ECONNRESET
        // then "Connection lost before handshake"); only the first counts.
        if (settled) return;
        settled = true;
        opts.signal.removeEventListener('abort', onAbort);
        client.end();
        if (mismatch) {
          reject(
            new SshError(
              'hostkey',
              `SSH host key for ${id} changed (expected ${known.get(id)}, got ${mismatch}). ` +
                `If the container was rebuilt, remove that line from ${opts.knownHostsFile}.`,
            ),
          );
        } else if (/authentication methods failed/i.test(err.message)) {
          reject(
            new SshError(
              'auth',
              `SSH authentication as ${target.user}@${target.host}:${target.port} failed. ` +
                'Add your public key to your account, load it into ssh-agent, or run deploy in a terminal to enter your password.',
            ),
          );
        } else {
          reject(new SshError('network', `SSH connection to ${target.host}:${target.port} failed: ${err.message}`, { cause: err }));
        }
      };
      // Keep a listener for the client's whole life: an unhandled 'error'
      // event would crash the process.
      client.on('error', fail);
      client.once('ready', () => {
        settled = true;
        opts.signal.removeEventListener('abort', onAbort);
        const done = (): void => resolve(new SshConnection(client));
        if (pinned) {
          logger.info(`Trusting SSH host key ${pinned.fp} for ${id}`);
          // Without a saved pin the next connection would trust any key, so
          // refuse to continue rather than silently dropping the guarantee.
          pinHostKey(opts.knownHostsFile, id, pinned.fp).then(done, (err: Error) => {
            client.end();
            reject(
              new SshError('hostkey', `Could not save the SSH host key to ${opts.knownHostsFile}: ${err.message}`, {
                cause: err,
              }),
            );
          });
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

  exec(command: string, stdin?: Buffer | NodeJS.ReadableStream, signal?: AbortSignal): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      this.client.exec(command, (err: Error | undefined, stream: ClientChannel) => {
        if (err) {
          reject(err);
          return;
        }
        const onAbort = (): void => {
          reject(signal!.reason);
          (stdin as { destroy?: () => void } | undefined)?.destroy?.();
          stream.close();
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        stream.on('close', () => signal?.removeEventListener('abort', onAbort));
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
        // An abort while the channel was opening fired before onAbort was
        // registered (AbortSignal doesn't replay): honor it now, send nothing.
        if (signal?.aborted) {
          onAbort();
          return;
        }
        if (stdin === undefined) stream.end();
        else if (Buffer.isBuffer(stdin)) stream.end(stdin);
        else {
          stdin.on('error', () => stream.close());
          stdin.pipe(stream);
        }
      });
    });
  }

  stream(
    command: string,
    onData: (chunk: Buffer, stream: 'stdout' | 'stderr') => void,
    signal: AbortSignal,
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        resolve(-1);
        return;
      }
      this.client.exec(command, (err: Error | undefined, stream: ClientChannel) => {
        if (err) {
          reject(err);
          return;
        }
        let code = -1;
        const onAbort = (): void => {
          stream.close();
        };
        signal.addEventListener('abort', onAbort, { once: true });
        stream.on('data', (d: Buffer) => onData(d, 'stdout'));
        stream.stderr.on('data', (d: Buffer) => onData(d, 'stderr'));
        stream.on('exit', (c: number | null) => {
          code = c ?? -1;
        });
        stream.on('close', () => {
          signal.removeEventListener('abort', onAbort);
          resolve(signal.aborted ? -1 : code);
        });
        stream.on('error', reject);
        // Aborted while the channel was opening: close it right away (the
        // 'close' handler above resolves -1) instead of running e.g. `tail -f`.
        if (signal.aborted) {
          onAbort();
          return;
        }
        stream.end();
      });
    });
  }

  hold(command: string, ready: string, signal: AbortSignal): Promise<{ release(): void }> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }
      this.client.exec(command, (err: Error | undefined, stream: ClientChannel) => {
        if (err) {
          reject(err);
          return;
        }
        let out = '';
        let stderr = '';
        let code: number | null = null;
        let held = false;
        const release = (): void => {
          stream.end(); // EOF: the held command (e.g. `cat`) exits, releasing the lock
          stream.close();
        };
        const onAbort = (): void => {
          release();
          if (!held) reject(signal.reason);
        };
        signal.addEventListener('abort', onAbort, { once: true });
        stream.on('data', (d: Buffer) => {
          if (held) return;
          out += d.toString('utf8');
          if (out.includes(ready)) {
            held = true;
            signal.removeEventListener('abort', onAbort);
            resolve({ release });
          }
        });
        stream.stderr.on('data', (d: Buffer) => {
          stderr = (stderr + d.toString('utf8')).slice(-4096);
        });
        stream.on('exit', (c: number | null) => {
          code = c;
        });
        stream.on('close', () => {
          signal.removeEventListener('abort', onAbort);
          if (!held) reject(Object.assign(new Error(stderr.trim() || `exited with code ${code}`), { code }));
        });
        stream.on('error', (e: Error) => {
          if (!held) reject(e);
        });
        if (signal.aborted) onAbort();
      });
    });
  }

  close(): void {
    this.client.end();
  }
}
