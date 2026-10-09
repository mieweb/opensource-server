/**
 * Configuration resolution: instance URL, API token, and the non-secret
 * `targets.mieweb` block of mieweb.jsonc.
 *
 * Precedence (issue #475 §3):
 *   token:        env.MIEWEB_OS_TOKEN → machine-local login cache (never config)
 *   instance URL: env.MIEWEB_OS_URL → targetConfig.instanceUrl → default
 */

import type { DeployContext, ProviderEnv } from '@mieweb/deploy-contract';
import { readCredential } from './credentials.ts';

export const PROVIDER_NAME = 'opensource-server';
export const DEFAULT_INSTANCE_URL = 'https://os.mieweb.org';
/**
 * Unreleased default. CI rewrites the tag when publishing: a release pins the
 * cloud image built for that same release (`cloud:<release tag>`), a PR
 * preview pins `cloud:pr-<N>` (scripts/set-default-image.mjs).
 */
export const DEFAULT_IMAGE = 'ghcr.io/mieweb/opensource-server/cloud:latest';
export const DEFAULT_PORT = 8787;
/** The one rw persistent volume the converged container's datastores live on (#421). */
export const DATA_VOLUME = { name: 'data', mountPath: '/mnt/data', mode: 'rw' } as const;

/** Same rule the Manager enforces on `Container.hostname` (models/container.js). */
export const DNS_LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export const LOGIN_HINT = 'set MIEWEB_OS_TOKEN, or run `mieweb login --target mieweb`';

/** Thrown for configuration problems the user must fix (not auth, not backend). */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * Canonical instance URL: scheme + host (+ port) + path without a trailing
 * slash or a trailing `/api/v1`. It is also the key for the login cache, so
 * `https://OS.mieweb.org/` and `https://os.mieweb.org` share one entry.
 */
export function normalizeInstanceUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ConfigError(`Invalid instance URL: ${JSON.stringify(raw)}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ConfigError(`Instance URL must be http(s): ${JSON.stringify(raw)}`);
  }
  if (url.username || url.password) {
    throw new ConfigError('Instance URL must not contain credentials');
  }
  let path = url.pathname.replace(/\/+$/, '');
  if (path.endsWith('/api/v1')) path = path.slice(0, -'/api/v1'.length);
  return `${url.protocol}//${url.host}${path}`;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

/** Instance URL for all verbs except `login` (see {@link loginInstanceUrl}). */
export function resolveInstanceUrl(env: ProviderEnv, targetConfig: Readonly<Record<string, unknown>>): string {
  return normalizeInstanceUrl(str(env.MIEWEB_OS_URL) ?? str(targetConfig.instanceUrl) ?? DEFAULT_INSTANCE_URL);
}

/** Value of `--instance <url>` / `--instance=<url>` in passthrough argv, if any. */
export function instanceFromArgv(argv: readonly string[]): string | undefined {
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    let value: string | undefined;
    if (a === '--instance') value = argv[i + 1];
    else if (a.startsWith('--instance=')) value = a.slice('--instance='.length);
    else continue;
    // A bare `--instance` must not fall back to the default Manager: login
    // would sign in to (and logout revoke keys on) the wrong instance.
    const url = str(value);
    if (!url || url.startsWith('-')) throw new ConfigError('--instance needs a Manager URL, e.g. --instance https://os.mieweb.org');
    return url;
  }
  return undefined;
}

export interface ResolvedToken {
  token: string;
  method: 'env' | 'login';
}

/** Token for `instanceUrl`, or null when neither env nor the login cache has one. */
export async function resolveToken(env: ProviderEnv, instanceUrl: string): Promise<ResolvedToken | null> {
  const fromEnv = str(env.MIEWEB_OS_TOKEN);
  if (fromEnv) return { token: fromEnv, method: 'env' };
  const cached = await readCredential(env, instanceUrl);
  return cached ? { token: cached.token, method: 'login' } : null;
}

/** Extra non-HTTP service declared in `targets.mieweb.services`. */
export interface ExtraService {
  type: 'tcp' | 'udp';
  internalPort: number;
}

/** The parts of `targets.mieweb` deploy/destroy use. All non-secret. */
export interface TargetSettings {
  instanceUrl: string;
  /** Manager site; undefined → chosen at deploy time (see resolveSiteId in deploy.ts). */
  siteId?: number;
  image: string;
  port: number;
  /** External hostname label; defaults to the app name. */
  externalHostname: string;
  /** External domain, by name or id; defaults to the site's first domain. */
  domain?: string | number;
  authRequired: boolean;
  nvidia?: boolean;
  services: ExtraService[];
  /** Sync the worktree into the container after converging (default true). */
  sync: boolean;
  /** SSH login for the sync (default: the Manager account). */
  sshUser?: string;
  /** SSH host override (default: the container's published sshHost). */
  sshHost?: string;
  /** Start command inside the container (default: the app's `start` script via its package manager). */
  start?: string;
}

function posInt(v: unknown, what: string): number {
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isInteger(n) || n <= 0) {
    throw new ConfigError(`${what} must be a positive integer, got ${JSON.stringify(v)}`);
  }
  return n;
}

function port(v: unknown, what: string): number {
  const n = posInt(v, what);
  if (n > 65535) throw new ConfigError(`${what} must be a TCP port (1-65535), got ${n}`);
  return n;
}

/** App name from wrangler.jsonc `name`; must be a DNS label (it becomes the hostname). */
export function appName(manifest: Readonly<Record<string, unknown>>): string {
  const name = manifest.name;
  if (typeof name !== 'string' || name === '') {
    throw new ConfigError('wrangler.jsonc must set `name` (it is used as the container hostname)');
  }
  if (!DNS_LABEL.test(name)) {
    throw new ConfigError(
      `wrangler.jsonc \`name\` ${JSON.stringify(name)} is not a valid DNS label ` +
        '(1-63 chars of a-z, 0-9 and "-", starting and ending with a letter or digit)',
    );
  }
  return name;
}

/** Validate `targets.mieweb` for deploy/destroy. */
export function resolveTargetSettings(ctx: DeployContext, env: ProviderEnv): TargetSettings {
  const tc = ctx.targetConfig;
  const name = appName(ctx.manifest);
  const target = `targets.${ctx.target}`;

  // MIEWEB_OS_SITE_ID → targets.mieweb.siteId → (deploy time) the only site, or a prompt.
  const rawSite = str(env.MIEWEB_OS_SITE_ID) ?? (tc.siteId === null || tc.siteId === '' ? undefined : tc.siteId);
  const siteId = rawSite === undefined ? undefined : posInt(rawSite, str(env.MIEWEB_OS_SITE_ID) ? 'MIEWEB_OS_SITE_ID' : `${target}.siteId`);

  const externalHostname = str(tc.externalHostname) ?? name;
  if (!DNS_LABEL.test(externalHostname)) {
    throw new ConfigError(`${target}.externalHostname ${JSON.stringify(externalHostname)} is not a valid DNS label`);
  }

  let domain: string | number | undefined;
  if (tc.domain !== undefined) {
    if (typeof tc.domain === 'number') domain = posInt(tc.domain, `${target}.domain`);
    else if (str(tc.domain)) domain = str(tc.domain);
    else throw new ConfigError(`${target}.domain must be a domain name or id`);
  }

  if (tc.authRequired !== undefined && typeof tc.authRequired !== 'boolean') {
    throw new ConfigError(`${target}.authRequired must be a boolean`);
  }
  if (tc.sync !== undefined && typeof tc.sync !== 'boolean') {
    throw new ConfigError(`${target}.sync must be a boolean`);
  }
  if (tc.source !== undefined || tc.ref !== undefined) {
    throw new ConfigError(
      `${target}.source/.ref are no longer used: deploy syncs your local worktree into the container over SSH`,
    );
  }
  if (tc.nvidia !== undefined && typeof tc.nvidia !== 'boolean') {
    throw new ConfigError(`${target}.nvidia must be a boolean`);
  }

  const services: ExtraService[] = [];
  if (tc.services !== undefined) {
    if (!Array.isArray(tc.services)) throw new ConfigError(`${target}.services must be an array`);
    for (const [i, raw] of tc.services.entries()) {
      const s = (raw ?? {}) as Record<string, unknown>;
      if (s.type === 'srv') {
        // The Manager stores SRV services, but its agent doesn't publish them
        // yet: accepting one would report a DNS record that never exists.
        throw new ConfigError(`${target}.services[${i}]: srv services aren't supported yet (the Manager doesn't publish SRV records)`);
      }
      if (s.type !== 'tcp' && s.type !== 'udp') {
        throw new ConfigError(`${target}.services[${i}].type must be tcp or udp (the HTTP service is implicit)`);
      }
      services.push({ type: s.type, internalPort: port(s.internalPort, `${target}.services[${i}].internalPort`) });
    }
  }

  return {
    instanceUrl: resolveInstanceUrl(env, tc),
    siteId,
    image: str(tc.image) ?? DEFAULT_IMAGE,
    port: tc.port === undefined ? DEFAULT_PORT : port(tc.port, `${target}.port`),
    externalHostname,
    domain,
    authRequired: tc.authRequired === true,
    nvidia: tc.nvidia as boolean | undefined,
    services,
    sync: tc.sync !== false,
    sshUser: str(env.MIEWEB_OS_SSH_USER) ?? str(tc.sshUser),
    sshHost: str(tc.sshHost),
    start: str(tc.start),
  };
}
