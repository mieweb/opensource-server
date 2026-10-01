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
import type { DeployContext, DeployResult, ProviderEnv } from '@mieweb/deploy-contract';
import type {
  Container,
  CreateContainerResult,
  DeleteContainerResult,
  EnvVar,
  NewContainerForm,
  ServiceUpdate,
  UpdateContainerResult,
  VolumeAttach,
} from './api-types.ts';
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
import type { SessionInfo } from './api-types.ts';
import { forgetHostKey, knownHostsPath, SshConnection, ttyPrompter, waitForSsh, type Prompter, type RemoteShell, type SshTarget } from './ssh.ts';
import { syncWorktree } from './sync.ts';

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
} as const;

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
 * The provider owns the app's HTTP exposure: every HTTP service that doesn't
 * match is removed. Non-HTTP services are only added (to match
 * `targets.mieweb.services`), never removed — e.g. an SSH port someone added
 * in the UI survives a redeploy.
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

  extras.forEach((want, i) => {
    const exists = (current ?? []).some((svc) =>
      want.type === 'srv'
        ? svc.type === 'dns' && svc.internalPort === want.internalPort && svc.dnsService?.dnsName === want.dnsName
        : svc.type === 'transport' && svc.internalPort === want.internalPort && svc.transportService?.protocol === want.type,
    );
    if (!exists) {
      plan[`extra-${i}`] = { type: want.type, internalPort: want.internalPort, ...(want.dnsName ? { dnsName: want.dnsName } : {}) };
    }
  });
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

function createServices(http: DesiredHttp, extras: readonly ExtraService[]): Record<string, ServiceUpdate> {
  return planServices([], http, extras);
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
  connectSsh?: (target: SshTarget, opts: { knownHostsFile: string; signal: AbortSignal; logger: DeployContext['logger'] }) => Promise<RemoteShell>;
  /** Wait for the SSH banner (tests inject a fake). */
  waitForSsh?: typeof waitForSsh;
  /** Terminal prompt for passphrases/passwords. */
  prompt?: Prompter;
}

async function clientFor(ctx: DeployContext, deps: ProviderDeps, instanceUrl: string): Promise<ManagerClient> {
  const tok = await resolveToken(deps.env, instanceUrl);
  return new ManagerClient({ instanceUrl, token: tok?.token ?? null, target: ctx.target, signal: ctx.signal, fetch: deps.fetch });
}

async function findByHostname(client: ManagerClient, siteId: number, hostname: string): Promise<Container | null> {
  const list = await client.get<Container[]>(`/sites/${siteId}/containers`, { hostname });
  return list.find((c) => c.hostname === hostname) ?? null;
}

interface SiteSummary {
  id: number;
  name: string;
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
  const sites = await client.get<SiteSummary[]>('/sites');
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
    process.stderr.write(`"${answer.trim()}" is not one of the listed sites\n`);
  }
}

export async function deploy(ctx: DeployContext, deps: ProviderDeps): Promise<DeployResult> {
  const { logger, signal } = ctx;
  const name = appName(ctx.manifest);
  const s = resolveTargetSettings(ctx, deps.env);
  const client = await clientFor(ctx, deps, s.instanceUrl);
  const siteId = await resolveSiteId(s.siteId, client, deps, ctx);
  const image = normalizeImageRef(s.image);
  const wait = (jobId: number): Promise<void> =>
    waitForJob(client, jobId, { signal, logger, intervalMs: deps.pollIntervalMs });

  logger.info(`Deploying "${name}" to site ${siteId} on ${s.instanceUrl}`);
  logger.info(`Image: ${image}`);

  const form = await client.get<NewContainerForm>(`/sites/${siteId}/containers/new`);
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
  const envFor = (existing?: Container | null): EnvVar[] =>
    buildEnv({
      manifest: ctx.manifest,
      env: deps.env,
      settings: s,
      existing: existing ? asEnvMap(existing.environmentVars) : undefined,
      warn: (m) => logger.warn(m),
    });

  let existing = await findByHostname(client, siteId, name);
  let carryEnv: Container | null = existing;

  if (existing) {
    // A create still in flight (e.g. a concurrent or interrupted deploy):
    // let it finish before deciding anything.
    if (!existing.containerId && existing.status === 'creating' && existing.creationJobId) {
      logger.info(`Container ${existing.id} is still being created; waiting for job ${existing.creationJobId}`);
      await waitForJob(client, existing.creationJobId, { signal, logger, intervalMs: deps.pollIntervalMs }).catch(() => {});
      existing = await findByHostname(client, siteId, name);
      carryEnv = existing;
    }
  }

  if (existing) {
    const drift: string[] = [];
    if (!existing.containerId) {
      // Never provisioned (failed/missing create); an update can't fix that.
      drift.push(`not provisioned (status ${existing.status ?? 'unknown'})`);
    }
    if (existing.template && normalizeImageRef(existing.template) !== image) {
      drift.push(`image ${existing.template} → ${image}`);
    }
    if (!!existing.nvidiaRequested !== nvidia) drift.push(`nvidia ${!!existing.nvidiaRequested} → ${nvidia}`);
    if (drift.length > 0) {
      logger.info(`Recreating container ${existing.id} (${drift.join(', ')}); ${DATA_VOLUME.mountPath} is retained`);
      const del = await client.delete<DeleteContainerResult>(`/sites/${siteId}/containers/${existing.id}`);
      for (const w of del.dnsWarnings ?? []) logger.warn(w);
      existing = null;
    }
  }

  let id: number;
  // Set when this deploy (re)created the container: its SSH host key is new.
  let fresh = false;
  if (!existing) {
    const created = await createOrAdopt(client, siteId, s, name, image, nvidia, envFor(carryEnv), http, logger);
    if ('created' in created) {
      id = created.created.containerId;
      fresh = true;
      logger.info(`Created container ${id}; waiting for job ${created.created.jobId}`);
      await wait(created.created.jobId);
    } else {
      // Lost a concurrent-create race: someone else created the same hostname
      // between our list and create. Converge it with an update instead.
      existing = created.adopted;
      carryEnv = existing;
    }
  }

  if (existing) {
    id = existing.id!;
    const services = planServices(existing.services, http, extras);
    const environmentVars = envFor(carryEnv);
    const body: Record<string, unknown> = {
      services,
      environmentVars,
      entrypoint: existing.entrypoint ?? null,
      restart: true,
    };
    let changed = !servicesUnchanged(existing.services, services) || !envUnchanged(existing.environmentVars, environmentVars);
    if (existing.volumes === undefined) {
      // Manager predates volumes (#421): it neither reports nor accepts them.
      logger.warn(
        `This Manager does not support volumes; ${DATA_VOLUME.mountPath} is not persistent and datastore state will not survive a container recreate`,
      );
    } else if (!existing.volumes.some((v) => v.mountPath === DATA_VOLUME.mountPath)) {
      body.volumes = [DATA_VOLUME satisfies VolumeAttach];
      changed = true;
      logger.info(`Attaching the ${DATA_VOLUME.mountPath} data volume`);
    } else if ((existing.volumes ?? []).some((v) => v.mountPath === DATA_VOLUME.mountPath && v.mode !== 'rw')) {
      logger.warn(`${DATA_VOLUME.mountPath} is attached read-only; the datastores need it read-write`);
    }
    // Code-only redeploys skip the Manager entirely and just sync.
    if (changed) {
    const upd = await client.put<UpdateContainerResult>(`/sites/${siteId}/containers/${id}`, body);
    for (const w of upd.dnsWarnings ?? []) logger.warn(w);
    if (upd.jobId) {
      logger.info(`Updated container ${id}; waiting for job ${upd.jobId}`);
      await wait(upd.jobId);
    } else {
      logger.info(`Updated container ${id}${upd.message ? `: ${upd.message}` : ''}`);
    }
    } else {
      logger.info(`Container ${id} configuration is up to date`);
    }
  }

  const final = await client.get<Container>(`/sites/${siteId}/containers/${id!}`);
  if (!final.containerId) {
    throw new Error(`Container ${id!} has no hypervisor id after the job finished (status: ${final.status ?? 'unknown'})`);
  }
  const url =
    final.httpEntries?.find((e) => e.port === s.port && e.externalUrl)?.externalUrl ??
    final.httpEntries?.find((e) => e.externalUrl)?.externalUrl ??
    undefined;

  if (s.sync) {
    const port = final.sshPort;
    const host = s.sshHost ?? final.sshHost ?? undefined;
    if (!port || !host) {
      throw new Error(`Container ${id!} has no published SSH port/host; cannot sync code (set targets.${ctx.target}.sync to false to skip)`);
    }
    const user = s.sshUser ?? (await client.get<SessionInfo>('/session')).user;
    const target: SshTarget = { host, port, user };
    const knownHostsFile = knownHostsPath(deps.env);
    if (fresh) await forgetHostKey(knownHostsFile, host, port);
    await (deps.waitForSsh ?? waitForSsh)(host, port, signal, logger);
    logger.info(`Connecting to ${user}@${host}:${port}`);
    const shell = deps.connectSsh
      ? await deps.connectSsh(target, { knownHostsFile, signal, logger })
      : await SshConnection.connect({ target, env: deps.env, knownHostsFile, prompt: deps.prompt, signal, logger });
    try {
      await syncWorktree(ctx.root, shell, logger);
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
): Promise<{ created: CreateContainerResult } | { adopted: Container }> {
  try {
    const created = await client.post<CreateContainerResult>(`/sites/${siteId}/containers`, {
      hostname: name,
      template: image,
      nvidiaRequested: nvidia,
      environmentVars,
      volumes: [DATA_VOLUME],
      services: createServices(http, withSsh(s.services)),
    });
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
  const res = await client.delete<DeleteContainerResult>(`/sites/${siteId}/containers/${existing.id}`);
  for (const w of res.dnsWarnings ?? []) ctx.logger.warn(w);
  const retained = (existing.volumes ?? []).some((v) => v.mountPath === DATA_VOLUME.mountPath);
  ctx.logger.info(
    `Destroyed container "${name}" (${existing.id}).` +
      (retained
        ? ` The ${DATA_VOLUME.mountPath} data directory is retained on the node and is reattached if you deploy the same name again.`
        : ''),
  );
}
