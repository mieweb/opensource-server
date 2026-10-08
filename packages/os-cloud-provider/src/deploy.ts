/**
 * `deploy` / `destroy`: converge one container per app on a Manager site.
 *
 * Identity is the hostname (= wrangler.jsonc `name`), unique per site, so
 * deploy is an upsert:
 *
 *   list_containers?hostname=<name>
 *     ├─ none            → create_container (retry as update on 409 conflict)
 *     ├─ same image/GPU  → update_container (services diff, full env, restart)
 *     └─ image/GPU drift → delete_container + create_container
 *                          (`template`/`nvidiaRequested` are create-only; the
 *                          /mnt/data volume is retained on delete (#421), so
 *                          datastore state survives the recreate)
 *
 * then poll the job and read the container back for the URL + VMID.
 */

import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { DeployContext, DeployResult, ProviderEnv } from '@mieweb/deploy-contract';
import pRetry from 'p-retry';
import { quote } from 'shell-quote';
import type { Container, EnvVar, NewContainerForm, ServiceUpdate, UpdateBody } from './api-types.ts';
import { ManagerApiError, ManagerClient } from './client.ts';
import {
  appName,
  ConfigError,
  DATA_VOLUME,
  resolveTargetSettings,
  resolveToken,
  type ExtraService,
  type TargetSettings,
} from './config.ts';
import { waitForJob } from './jobs.ts';
import { ttyPrompter, type Prompter } from './prompt.ts';
import { forgetHostKey, knownHostsPath, SshConnection, SshError, type RemoteShell, type SshTarget } from './ssh.ts';
import { lineSplitter, syncWorktree } from './sync.ts';

/** Env keys the provider owns inside the converged container. */
export const MANAGED_ENV = {
  port: 'PORT',
  target: 'MIEWEB_TARGET',
  start: 'MIEWEB_APP_START',
  minioUser: 'MINIO_ROOT_USER',
  minioPassword: 'MINIO_ROOT_PASSWORD',
  s3Endpoint: 'MIEWEB_S3_ENDPOINT',
  s3AccessKey: 'MIEWEB_S3_ACCESS_KEY_ID',
  s3SecretKey: 'MIEWEB_S3_SECRET_ACCESS_KEY',
  libsqlUrl: 'MIEWEB_LIBSQL_URL',
  valkeyUrl: 'MIEWEB_VALKEY_URL',
  sshAllowUsers: 'MIEWEB_SSH_ALLOW_USERS',
} as const;

/** Account names sshd may match literally (no patterns, no separators). */
const SSH_USER_RE = /^[a-z_][a-z0-9_.-]{0,63}$/i;

/**
 * Who may SSH into the converged container: its owner and collaborators, the
 * account deploying (an admin may deploy someone else's app) and the sync
 * login. The cloud image restricts sshd to exactly these accounts, because
 * the container holds app secrets and datastore files and every LDAP user
 * otherwise has SSH + passwordless sudo on every container.
 */
export function sshAllowUsers(names: readonly (string | null | undefined)[]): string[] {
  return [...new Set(names.filter((n): n is string => !!n && SSH_USER_RE.test(n)))].sort();
}

/** Provider env vars with this prefix are injected (prefix stripped) as app secrets. */
export const SECRET_ENV_PREFIX = 'MIEWEB_OS_SECRET_';

/**
 * Same normalization the Manager applies to `template` on create
 * (normalizeDockerRef in routers/api/v1/containers.js), so a stored template
 * can be compared with the configured image.
 */
export function normalizeImageRef(ref: string): string {
  if (ref.startsWith('http://') || ref.startsWith('https://') || ref.startsWith('git@')) return ref;
  let tag = 'latest';
  let imagePart = ref;
  const lastColon = ref.lastIndexOf(':');
  if (lastColon !== -1) {
    const potentialTag = ref.substring(lastColon + 1);
    if (!potentialTag.includes('/')) {
      tag = potentialTag;
      imagePart = ref.substring(0, lastColon);
    }
  }
  const parts = imagePart.split('/');
  let host = 'docker.io';
  let org = 'library';
  let image: string;
  if (parts.length === 1) {
    image = parts[0]!;
  } else if (parts.length === 2) {
    if (parts[0]!.includes('.') || parts[0]!.includes(':')) {
      host = parts[0]!;
      image = parts[1]!;
    } else {
      org = parts[0]!;
      image = parts[1]!;
    }
  } else {
    host = parts[0]!;
    image = parts[parts.length - 1]!;
    org = parts.slice(1, -1).join('/');
  }
  return `${host}/${org}/${image}:${tag}`;
}

/** Pick the external domain to expose the app under. */
export function pickDomain(form: NewContainerForm, wanted: string | number | undefined): { id: number; name: string } {
  const domains = form.externalDomains ?? [];
  if (wanted !== undefined) {
    const hit = domains.find((d) => (typeof wanted === 'number' ? d.id === wanted : d.name === wanted));
    if (!hit) {
      const names = domains.map((d) => `${d.name} (${d.id})`).join(', ') || 'none';
      throw new ConfigError(`External domain ${JSON.stringify(wanted)} is not available on this site (available: ${names})`);
    }
    return { id: hit.id, name: hit.name };
  }
  // The Manager sorts the site's own default domains first.
  const first = domains[0];
  if (!first) throw new ConfigError('The site has no external domains; ask an admin to add one, or set targets.mieweb.domain');
  return { id: first.id, name: first.name };
}

function envString(v: unknown): string {
  return typeof v === 'string' ? v : JSON.stringify(v);
}

export interface EnvInputs {
  manifest: Readonly<Record<string, unknown>>;
  env: ProviderEnv;
  settings: Pick<TargetSettings, 'port' | 'start'>;
  /** Current env map of the existing container (read shape is an object). */
  existing?: Record<string, string>;
  /** Accounts allowed to SSH in (see {@link sshAllowUsers}). */
  sshAllowUsers?: readonly string[];
  warn: (m: string) => void;
}

/**
 * The complete desired env set. `update_container` treats `environmentVars`
 * as a full replacement, so this always returns everything.
 *
 * Order of precedence (later wins): wrangler `vars` → MIEWEB_OS_SECRET_* from
 * the provider env → provider-managed keys (warned on collision).
 */
export function buildEnv(inputs: EnvInputs): EnvVar[] {
  const out = new Map<string, string>();
  const vars = inputs.manifest.vars;
  if (vars && typeof vars === 'object' && !Array.isArray(vars)) {
    for (const [k, v] of Object.entries(vars)) out.set(k, envString(v));
  }
  for (const [k, v] of Object.entries(inputs.env)) {
    if (k.startsWith(SECRET_ENV_PREFIX) && k.length > SECRET_ENV_PREFIX.length && v !== undefined) {
      out.set(k.slice(SECRET_ENV_PREFIX.length), v);
    }
  }

  // Reuse the generated MinIO secret: the data on /mnt/data was written with
  // it, so it must survive redeploys and image-change recreates.
  const minioPassword =
    inputs.existing?.[MANAGED_ENV.minioPassword] || randomBytes(24).toString('base64url');
  const minioUser = inputs.existing?.[MANAGED_ENV.minioUser] || 'mieweb';

  const managed: [string, string | undefined][] = [
    [MANAGED_ENV.port, String(inputs.settings.port)],
    [MANAGED_ENV.target, 'mieweb'],
    [MANAGED_ENV.start, inputs.settings.start],
    [MANAGED_ENV.minioUser, minioUser],
    [MANAGED_ENV.minioPassword, minioPassword],
    [MANAGED_ENV.s3Endpoint, 'http://127.0.0.1:9000'],
    [MANAGED_ENV.s3AccessKey, minioUser],
    [MANAGED_ENV.s3SecretKey, minioPassword],
    [MANAGED_ENV.libsqlUrl, 'http://127.0.0.1:8080'],
    [MANAGED_ENV.valkeyUrl, 'redis://127.0.0.1:6379'],
    [MANAGED_ENV.sshAllowUsers, inputs.sshAllowUsers?.length ? inputs.sshAllowUsers.join(' ') : undefined],
  ];
  for (const [k, v] of managed) {
    if (v === undefined) continue;
    if (out.has(k) && out.get(k) !== v) inputs.warn(`Env var ${k} is managed by the provider; ignoring the app's value`);
    out.set(k, v);
  }
  return [...out.entries()].map(([key, value]) => ({ key, value }));
}

export interface DesiredHttp {
  internalPort: number;
  externalHostname: string;
  externalDomainId: number;
  authRequired: boolean;
}

/**
 * Diff the container's services against the desired set and produce an
 * `update_container` services map.
 *
 * The provider owns the container's exposure: one HTTP service, plus the
 * non-HTTP services in `extras` (which always include the provider's SSH
 * service). Each desired service is matched to at most one existing service;
 * every unmatched existing service is deleted, so removing an entry from
 * `targets.mieweb.services` closes that port on the next deploy.
 */
export function planServices(
  current: Container['services'],
  http: DesiredHttp,
  extras: readonly ExtraService[],
): Record<string, ServiceUpdate> {
  const plan: Record<string, ServiceUpdate> = {};
  let keptHttp = false;
  for (const svc of current ?? []) {
    if (svc.type !== 'http' || svc.id === undefined) continue;
    const h = svc.httpService;
    const matches =
      !keptHttp &&
      svc.internalPort === http.internalPort &&
      h?.externalHostname === http.externalHostname &&
      h?.externalDomainId === http.externalDomainId &&
      (h?.backendProtocol ?? 'http') === 'http';
    if (matches) {
      keptHttp = true;
      // Existing entries may only toggle authRequired.
      plan[`keep-${svc.id}`] = { id: svc.id, type: 'http', internalPort: http.internalPort, authRequired: http.authRequired };
    } else {
      plan[`del-${svc.id}`] = { id: svc.id, deleted: true, type: 'http', internalPort: svc.internalPort ?? 0 };
    }
  }
  if (!keptHttp) {
    plan.http = {
      type: 'http',
      internalPort: http.internalPort,
      externalHostname: http.externalHostname,
      externalDomainId: http.externalDomainId,
      authRequired: http.authRequired,
    };
  }

  const others = (current ?? []).filter((svc) => svc.type !== 'http' && svc.id !== undefined);
  const matched = new Set<number>();
  extras.forEach((want, i) => {
    const hit = others.find(
      (svc) =>
        !matched.has(svc.id!) &&
        svc.internalPort === want.internalPort &&
        (want.type === 'srv'
          ? svc.type === 'dns' && svc.dnsService?.dnsName === want.dnsName
          : svc.type === 'transport' && svc.transportService?.protocol === want.type),
    );
    if (hit) matched.add(hit.id!);
    else plan[`extra-${i}`] = { type: want.type, internalPort: want.internalPort, ...(want.dnsName ? { dnsName: want.dnsName } : {}) };
  });
  for (const svc of others) {
    if (!matched.has(svc.id!)) {
      const type = svc.type === 'dns' ? 'srv' : (svc.transportService?.protocol ?? 'tcp');
      plan[`del-${svc.id}`] = { id: svc.id, deleted: true, type, internalPort: svc.internalPort ?? 0 };
    }
  }
  return plan;
}

/** The SSH service the code sync uses; always requested. */
export const SSH_SERVICE: ExtraService = { type: 'tcp', internalPort: 22 };

function withSsh(extras: readonly ExtraService[]): ExtraService[] {
  return extras.some((e) => e.type === 'tcp' && e.internalPort === 22) ? [...extras] : [SSH_SERVICE, ...extras];
}

/** True when applying `plan` to `current` would change nothing. */
export function servicesUnchanged(current: Container['services'], plan: Record<string, ServiceUpdate>): boolean {
  return Object.entries(plan).every(([key, entry]) => {
    if (!key.startsWith('keep-')) return false;
    const svc = (current ?? []).find((c) => c.id === entry.id);
    return (svc?.httpService?.authRequired ?? false) === (entry.authRequired ?? false);
  });
}

export function envUnchanged(current: unknown, desired: readonly EnvVar[]): boolean {
  const cur = asEnvMap(current);
  return (
    Object.keys(cur).length === desired.length && desired.every((e) => cur[e.key ?? ''] === (e.value ?? ''))
  );
}

function asEnvMap(v: unknown): Record<string, string> {
  if (Array.isArray(v)) return Object.fromEntries(v.map((e: EnvVar) => [e.key ?? '', e.value ?? '']));
  return v && typeof v === 'object' ? (v as Record<string, string>) : {};
}

/** Whether AI is bound in wrangler.jsonc (suggests a GPU node). */
function wantsAi(manifest: Readonly<Record<string, unknown>>): boolean {
  return manifest.ai !== undefined && manifest.ai !== null;
}

export interface ProviderDeps {
  env: ProviderEnv;
  fetch?: typeof fetch;
  /** Job poll interval (tests shorten it). */
  pollIntervalMs?: number;
  /** Open the SSH session used for the code sync (tests inject a fake). */
  connectSsh?: (
    target: SshTarget,
    opts: { knownHostsFile: string; signal: AbortSignal; logger: DeployContext['logger']; prompt: Prompter },
  ) => Promise<RemoteShell>;
  /** Terminal prompt for passphrases/passwords. */
  prompt?: Prompter;
  /** Total time to keep trying to reach SSH (default 60 s; tests shorten it). */
  sshTimeoutMs?: number;
  /** Delay between SSH connection attempts (default 2 s). */
  sshRetryDelayMs?: number;
}

async function clientFor(ctx: DeployContext, deps: ProviderDeps, instanceUrl: string): Promise<ManagerClient> {
  const tok = await resolveToken(deps.env, instanceUrl);
  return new ManagerClient({ instanceUrl, token: tok?.token ?? null, target: ctx.target, signal: ctx.signal, fetch: deps.fetch });
}

async function findByHostname(client: ManagerClient, siteId: number, hostname: string): Promise<Container | null> {
  const list = await client.call((api) =>
    api.GET('/sites/{siteId}/containers', { params: { path: { siteId }, query: { hostname } } }),
  );
  return list?.find((c) => c.hostname === hostname) ?? null;
}

function getContainer(client: ManagerClient, siteId: number, id: number): Promise<Container | undefined> {
  return client.call((api) => api.GET('/sites/{siteId}/containers/{id}', { params: { path: { siteId, id } } }));
}

async function deleteContainer(client: ManagerClient, siteId: number, id: number, logger: DeployContext['logger']): Promise<void> {
  const res = await client.call((api) => api.DELETE('/sites/{siteId}/containers/{id}', { params: { path: { siteId, id } } }));
  for (const w of res?.dnsWarnings ?? []) logger.warn(w);
}

/**
 * The site to deploy into when none is configured: the only site the user can
 * see, otherwise ask on the terminal. Non-interactive runs get an error that
 * lists the choices.
 */
export async function resolveSiteId(
  configured: number | undefined,
  client: ManagerClient,
  deps: ProviderDeps,
  ctx: DeployContext,
): Promise<number> {
  if (configured !== undefined) return configured;
  const { logger, target } = ctx;
  const sites = ((await client.call((api) => api.GET('/sites'))) ?? []).flatMap((x) =>
    x.id === undefined ? [] : [{ id: x.id, name: x.name ?? `site ${x.id}` }],
  );
  type SiteSummary = (typeof sites)[number];
  // Save the choice to mieweb.jsonc when the host supports it (CLI >= this
  // contract); otherwise tell the user what to set.
  const remember = async (site: SiteSummary, why: string): Promise<number> => {
    logger.info(`Using site ${site.id} (${site.name})${why}`);
    const saved = await ctx.persistTargetConfig?.({ siteId: site.id }).catch((err: unknown) => {
      logger.warn(`Could not save siteId to mieweb.jsonc: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    });
    if (!saved) logger.info(`Set targets.${target}.siteId to ${site.id} in mieweb.jsonc (or MIEWEB_OS_SITE_ID) to skip this`);
    return site.id;
  };
  if (sites.length === 0) throw new ConfigError('No Manager sites are visible to your account');
  const [only] = sites;
  if (sites.length === 1 && only) return remember(only, ', the only one available');
  const list = sites.map((x) => `  ${x.id}) ${x.name}`).join('\n');
  const prompt = deps.prompt ?? ttyPrompter;
  for (;;) {
    const answer = await prompt(`Manager sites:\n${list}\nSite to deploy into: `, false);
    if (answer === null) {
      throw new ConfigError(`targets.${target}.siteId is required (the Manager site to deploy into). Available:\n${list}`);
    }
    const pick = sites.find((x) => String(x.id) === answer.trim() || x.name === answer.trim());
    if (pick) return remember(pick, '');
    logger.warn(`"${answer.trim()}" is not one of the listed sites`);
  }
}

export async function deploy(ctx: DeployContext, deps: ProviderDeps): Promise<DeployResult> {
  const { logger, signal } = ctx;
  const name = appName(ctx.manifest);
  const s = resolveTargetSettings(ctx, deps.env);
  // app.service only starts once /opt/app/src/package.json exists; fail before
  // creating anything rather than after a confusing "app stopped" timeout.
  if (s.sync && !existsSync(join(ctx.root, 'package.json'))) {
    throw new ConfigError(`${ctx.root} has no package.json; the container runs the app with npm`);
  }
  const client = await clientFor(ctx, deps, s.instanceUrl);
  const siteId = await resolveSiteId(s.siteId, client, deps, ctx);
  const image = normalizeImageRef(s.image);
  logger.info(`Deploying "${name}" to site ${siteId} on ${s.instanceUrl}`);
  logger.info(`Image: ${image}`);

  const form = await client.call((api) => api.GET('/sites/{siteId}/containers/new', { params: { path: { siteId } } }));
  if (!form) throw new Error(`Site ${siteId} returned no container form`);
  const domain = pickDomain(form, s.domain);
  let nvidia = s.nvidia ?? false;
  if (s.nvidia === undefined && wantsAi(ctx.manifest)) {
    nvidia = form.nvidiaAvailable;
    logger.info(
      nvidia
        ? 'AI binding found; requesting an NVIDIA node'
        : 'AI binding found but the site has no NVIDIA node; deploying without a GPU',
    );
  }

  const extras = withSsh(s.services);
  const http: DesiredHttp = {
    internalPort: s.port,
    externalHostname: s.externalHostname,
    externalDomainId: domain.id,
    authRequired: s.authRequired,
  };
  const account = (await client.call((api) => api.GET('/session')))?.user;
  const envFor = (existing?: Container | null): EnvVar[] =>
    buildEnv({
      manifest: ctx.manifest,
      env: deps.env,
      settings: s,
      existing: existing ? asEnvMap(existing.environmentVars) : undefined,
      // A new container is owned by the deploying account.
      sshAllowUsers: sshAllowUsers([
        existing?.owner ?? account,
        ...(existing?.collaborators ?? []),
        account,
        s.sshUser ?? account,
      ]),
      warn: (m) => logger.warn(m),
    });

  // Values to mask in relayed job output (older Managers log the full LXC
  // config, whose `env` holds every variable). Filled as env sets are built.
  const secrets = new Set<string>();
  const secretKeys = new Set<string>([MANAGED_ENV.minioPassword, MANAGED_ENV.s3SecretKey]);
  for (const k of Object.keys(deps.env)) {
    if (k.startsWith(SECRET_ENV_PREFIX) && k.length > SECRET_ENV_PREFIX.length) secretKeys.add(k.slice(SECRET_ENV_PREFIX.length));
  }
  const envWithSecrets = (existing?: Container | null): EnvVar[] => {
    const env = envFor(existing);
    for (const e of env) if (e.key && secretKeys.has(e.key) && e.value) secrets.add(e.value);
    return env;
  };
  const wait = (jobId: number): Promise<void> =>
    waitForJob(client, jobId, { signal, logger, intervalMs: deps.pollIntervalMs, redact: secrets });

  /**
   * Let an in-flight create (a concurrent or interrupted deploy) finish, then
   * re-read the container. Null if it no longer exists.
   */
  const settle = async (c: Container): Promise<Container | null> => {
    if (c.containerId || c.status !== 'creating' || !c.creationJobId) return c;
    logger.info(`Container ${c.id} is still being created; waiting for job ${c.creationJobId}`);
    // Its outcome is judged below from the re-read; only an abort stops us.
    await wait(c.creationJobId).catch((err: unknown) => {
      if (signal.aborted) throw err;
    });
    return findByHostname(client, siteId, name);
  };
  /** Why `c` must be deleted and recreated rather than updated, if it must. */
  const driftOf = (c: Container): string[] => {
    const drift: string[] = [];
    // Never provisioned (failed/missing create); an update can't fix that.
    if (!c.containerId) drift.push(`not provisioned (status ${c.status ?? 'unknown'})`);
    if (c.template && normalizeImageRef(c.template) !== image) drift.push(`image ${c.template} → ${image}`);
    if (!!c.nvidiaRequested !== nvidia) drift.push(`nvidia ${!!c.nvidiaRequested} → ${nvidia}`);
    return drift;
  };

  let existing = await findByHostname(client, siteId, name);
  // The env of the container being replaced: reused so the MinIO credentials
  // that own the data on /mnt/data survive recreates.
  let carryEnv: Container | null = existing;
  let createdId: number | undefined;
  // A lost create race hands us someone else's container, which goes through
  // the same settle/drift checks; bound the loop in case of repeated races.
  for (let round = 0; createdId === undefined; round += 1) {
    if (existing) {
      existing = await settle(existing);
      if (existing) carryEnv = existing;
    }
    const drift = existing ? driftOf(existing) : [];
    if (existing && drift.length > 0) {
      logger.info(`Recreating container ${existing.id} (${drift.join(', ')}); ${DATA_VOLUME.mountPath} is retained`);
      await deleteContainer(client, siteId, existing.id!, logger);
      existing = null;
    }
    if (existing) break;
    if (round >= 2) throw new Error(`Could not create container "${name}": it kept being created concurrently`);
    const created = await createOrAdopt(client, siteId, s, name, image, nvidia, envWithSecrets(carryEnv), http, logger);
    if ('adopted' in created) {
      existing = created.adopted;
      continue;
    }
    createdId = created.created.containerId!;
    logger.info(`Created container ${createdId}; waiting for job ${created.created.jobId}`);
    await wait(created.created.jobId!);
  }
  // Set when this deploy (re)created the container: its SSH host key is new.
  const fresh = createdId !== undefined;
  const id = createdId ?? existing!.id!;

  if (existing) {
    const services = planServices(existing.services, http, extras);
    const environmentVars = envWithSecrets(carryEnv);
    const body: UpdateBody = {
      services,
      environmentVars,
      entrypoint: existing.entrypoint ?? null,
      restart: true,
    };
    let changed = !servicesUnchanged(existing.services, services) || !envUnchanged(existing.environmentVars, environmentVars);
    // `volumes` is absent on Managers that predate volumes (#421); warned about below.
    const dataVolume = existing.volumes?.find((v) => v.mountPath === DATA_VOLUME.mountPath);
    if (existing.volumes && !dataVolume) {
      body.volumes = [DATA_VOLUME];
      changed = true;
      logger.info(`Attaching the ${DATA_VOLUME.mountPath} data volume`);
    } else if (dataVolume && dataVolume.mode !== 'rw') {
      throw new ConfigError(
        `${DATA_VOLUME.mountPath} is attached read-only to container ${id}, but MinIO, libSQL and Valkey need to write ` +
          'to it. Detach it (or delete the container) and deploy again.',
      );
    } else if (dataVolume && dataVolume.status !== 'ready' && dataVolume.id !== undefined) {
      // A row isn't a mount: an earlier attach failed or never finished, so
      // the container is using the image's (ephemeral) /mnt/data. Detach and
      // re-attach, which makes the Manager provision and mount it again.
      body.volumes = [{ id: dataVolume.id, detach: true }, DATA_VOLUME];
      changed = true;
      logger.warn(
        `The ${DATA_VOLUME.mountPath} volume is ${dataVolume.status ?? 'not ready'}` +
          `${dataVolume.statusMessage ? ` (${dataVolume.statusMessage})` : ''}; re-attaching it`,
      );
    }
    // Code-only redeploys skip the Manager entirely and just sync.
    if (!changed) {
      logger.info(`Container ${id} configuration is up to date`);
    } else {
      const upd = await client.call((api) =>
        api.PUT('/sites/{siteId}/containers/{id}', { params: { path: { siteId, id } }, body }),
      );
      for (const w of upd?.dnsWarnings ?? []) logger.warn(w);
      if (upd?.jobId) {
        logger.info(`Updated container ${id}; waiting for job ${upd.jobId}`);
        await wait(upd.jobId);
      } else {
        logger.info(`Updated container ${id}${upd?.message ? `: ${upd.message}` : ''}`);
      }
    }
  }

  const final = await getContainer(client, siteId, id);
  if (!final?.containerId) {
    throw new Error(`Container ${id} has no hypervisor id after the job finished (status: ${final?.status ?? 'unknown'})`);
  }
  if (final.volumes === undefined) {
    logger.warn(
      `This Manager does not support volumes; ${DATA_VOLUME.mountPath} is not persistent and datastore state will not survive a container recreate`,
    );
  } else {
    // The jobs above block until the volume is ready, so anything else here
    // means the datastores would be writing to non-persistent storage.
    const dv = final.volumes.find((v) => v.mountPath === DATA_VOLUME.mountPath);
    if (dv?.status !== 'ready') {
      throw new Error(
        `The ${DATA_VOLUME.mountPath} data volume on container ${id} is ${dv ? (dv.status ?? 'not ready') : 'missing'}` +
          `${dv?.statusMessage ? `: ${dv.statusMessage}` : ''}. Its data would not persist; fix the volume (see the Manager) and deploy again.`,
      );
    }
  }
  const url =
    final.httpEntries?.find((e) => e.port === s.port && e.externalUrl)?.externalUrl ??
    final.httpEntries?.find((e) => e.externalUrl)?.externalUrl ??
    undefined;

  if (s.sync) {
    if (!final.sshPort || !(s.sshHost ?? final.sshHost)) {
      throw new Error(`Container ${id} has no published SSH port/host; cannot sync code (set targets.${ctx.target}.sync to false to skip)`);
    }
    const shell = await openShell(ctx, deps, client, s, final, { fresh });
    try {
      await syncWorktree(ctx.root, shell, logger, signal);
    } finally {
      shell.close();
    }
  } else {
    logger.info('Code sync disabled (sync: false)');
  }

  if (url) logger.info(`Live at ${url}`);
  return {
    ...(url ? { url } : {}),
    resources: [{ binding: name, kind: 'container', id: String(final.containerId) }],
  };
}

/**
 * Open an SSH session to the container. A freshly created/rebuilt container
 * can take a while before sshd accepts connections and (via SSSD) serves the
 * user's LDAP keys, so transient failures are retried within one budget
 * (default 60 s).
 */
export async function openShell(
  ctx: DeployContext,
  deps: ProviderDeps,
  client: ManagerClient,
  s: TargetSettings,
  container: Container,
  opts: { fresh?: boolean } = {},
): Promise<RemoteShell> {
  const { logger, signal } = ctx;
  const port = container.sshPort;
  const host = s.sshHost ?? container.sshHost ?? undefined;
  if (!port || !host) throw new Error(`Container ${container.id} has no published SSH port/host`);
  const user = s.sshUser ?? (await client.call((api) => api.GET('/session')))?.user ?? '';
  const target: SshTarget = { host, port, user };
  const knownHostsFile = knownHostsPath(deps.env);
  if (opts.fresh) await forgetHostKey(knownHostsFile, host, port);

  const budgetMs = deps.sshTimeoutMs ?? 60_000;
  const deadline = Date.now() + budgetMs;
  // Ask for a password/passphrase at most once across attempts. Once the
  // user has typed one, an auth failure is theirs to fix, not a startup race.
  const answers = new Map<string, string | null>();
  const basePrompt = deps.prompt ?? ttyPrompter;
  const prompt: Prompter = async (q, hidden) => {
    if (!answers.has(q)) answers.set(q, await basePrompt(q, hidden));
    return answers.get(q)!;
  };

  logger.info(`Connecting to ${user}@${host}:${port}`);
  let attempts = 0;
  try {
    return await pRetry(
      () => {
        attempts += 1;
        const timeoutMs = Math.min(20_000, Math.max(deadline - Date.now(), 5000));
        return deps.connectSsh
          ? deps.connectSsh(target, { knownHostsFile, signal, logger, prompt })
          : SshConnection.connect({ target, env: deps.env, knownHostsFile, prompt, signal, logger, timeoutMs });
      },
      {
        retries: Number.POSITIVE_INFINITY,
        factor: 1,
        minTimeout: deps.sshRetryDelayMs ?? 2000,
        maxRetryTime: budgetMs,
        signal,
        shouldRetry: ({ error }) => {
          const kind = error instanceof SshError ? error.kind : 'network';
          const retry = kind === 'network' || (kind === 'auth' && opts.fresh === true && answers.size === 0);
          if (retry) logger.info(`SSH not ready yet (${error.message.split('. ')[0]}); retrying…`);
          return retry;
        },
      },
    );
  } catch (err) {
    const transient = !(err instanceof SshError) || err.kind === 'network' || (err.kind === 'auth' && opts.fresh);
    if (attempts > 1 && transient && !signal.aborted) {
      throw new Error(
        `SSH on ${host}:${port} was not usable within ${Math.round(budgetMs / 1000)}s (${attempts} attempts): ${(err as Error).message}`,
        { cause: err },
      );
    }
    throw err;
  }
}

export interface TailOptions {
  lines: number;
  follow: boolean;
  since?: string;
}

/** Parse `mieweb tail` passthrough args: `-n/--lines N`, `--no-follow`, `--since <time>`. */
export function parseTailArgs(argv: readonly string[]): TailOptions {
  const out: TailOptions = { lines: 100, follow: true };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    const val = (): string => {
      const eq = a.indexOf('=');
      if (eq !== -1) return a.slice(eq + 1);
      const v = argv[++i];
      if (v === undefined) throw new ConfigError(`${a} needs a value`);
      return v;
    };
    if (a === '-n' || a === '--lines' || a.startsWith('--lines=')) {
      const n = Number(val());
      if (!Number.isInteger(n) || n < 0) throw new ConfigError(`${a} must be a non-negative integer`);
      out.lines = n;
    } else if (a === '--no-follow') out.follow = false;
    else if (a === '--since' || a.startsWith('--since=')) {
      const v = val();
      // journalctl accepts e.g. "2026-10-01 12:00", "-1h", "yesterday". The
      // value is shell-quoted; this just rejects obvious garbage early.
      if (!/^[A-Za-z0-9 :+.-]{1,40}$/.test(v)) throw new ConfigError(`--since value ${JSON.stringify(v)} is not a valid time`);
      out.since = v;
    } else throw new ConfigError(`Unknown tail option ${JSON.stringify(a)} (supported: -n/--lines N, --no-follow, --since <time>)`);
  }
  return out;
}

export function journalCommand(o: TailOptions): string {
  const args = ['sudo', 'journalctl', '-u', 'app.service', '-o', 'cat', '--no-pager', '-n', String(o.lines)];
  if (o.since) args.push('--since', o.since);
  if (o.follow) args.push('-f');
  return quote(args);
}

/** `mieweb tail`: stream app.service's journal until aborted (or the end, with --no-follow). */
export async function tail(ctx: DeployContext, deps: ProviderDeps): Promise<void> {
  const opts = parseTailArgs(ctx.argv);
  const name = appName(ctx.manifest);
  const s = resolveTargetSettings(ctx, deps.env);
  const client = await clientFor(ctx, deps, s.instanceUrl);
  const siteId = await resolveSiteId(s.siteId, client, deps, ctx);
  const found = await findByHostname(client, siteId, name);
  const container = found?.id === undefined ? undefined : await getContainer(client, siteId, found.id);
  if (!container) throw new Error(`No container "${name}" on site ${siteId}; run \`mieweb deploy\` first`);
  const shell = await openShell(ctx, deps, client, s, container);
  try {
    ctx.logger.info(`Tailing app.service on "${name}"${opts.follow ? ' (Ctrl-C to stop)' : ''}`);
    const lines = lineSplitter((line, which) => (which === 'stderr' ? ctx.logger.warn(line) : ctx.logger.info(line)));
    const code = await shell.stream(journalCommand(opts), lines.push, ctx.signal);
    lines.flush();
    if (code > 0) throw new Error(`journalctl exited with code ${code}`);
  } finally {
    shell.close();
  }
}

async function createOrAdopt(
  client: ManagerClient,
  siteId: number,
  s: TargetSettings,
  name: string,
  image: string,
  nvidia: boolean,
  environmentVars: EnvVar[],
  http: DesiredHttp,
  logger: DeployContext['logger'],
): Promise<{ created: { containerId?: number; jobId?: number } } | { adopted: Container }> {
  try {
    const created = await client.call((api) =>
      api.POST('/sites/{siteId}/containers', {
        params: { path: { siteId } },
        body: {
          hostname: name,
          template: image,
          nvidiaRequested: nvidia,
          environmentVars,
          volumes: [DATA_VOLUME],
          services: planServices([], http, withSsh(s.services)),
        },
      }),
    );
    if (created?.containerId === undefined || created.jobId === undefined) {
      throw new Error('The Manager did not return the new container and job ids');
    }
    return { created };
  } catch (err) {
    if (!(err instanceof ManagerApiError) || err.status !== 409 || err.code !== 'conflict') throw err;
    const adopted = await findByHostname(client, siteId, name);
    if (!adopted) {
      throw new Error(
        `Hostname "${name}" is already taken on site ${siteId} by a container you cannot manage; ` +
          'rename the app (wrangler.jsonc `name`) or ask its owner to delete it.',
        { cause: err },
      );
    }
    logger.info(`Container "${name}" was created concurrently; updating it instead`);
    return { adopted };
  }
}

export async function destroy(ctx: DeployContext, deps: ProviderDeps): Promise<void> {
  const name = appName(ctx.manifest);
  const s = resolveTargetSettings(ctx, deps.env);
  const client = await clientFor(ctx, deps, s.instanceUrl);
  const siteId = await resolveSiteId(s.siteId, client, deps, ctx);
  const existing = await findByHostname(client, siteId, name);
  if (!existing) {
    ctx.logger.info(`No container "${name}" on site ${siteId}; nothing to destroy`);
    return;
  }
  await deleteContainer(client, siteId, existing.id!, ctx.logger);
  const retained = (existing.volumes ?? []).some((v) => v.mountPath === DATA_VOLUME.mountPath);
  ctx.logger.info(
    `Destroyed container "${name}" (${existing.id}).` +
      (retained
        ? ` The ${DATA_VOLUME.mountPath} data directory is retained on the node and is reattached if you deploy the same name again.`
        : ''),
  );
}
