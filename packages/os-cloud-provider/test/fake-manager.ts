/**
 * In-memory fake of the Manager API surface the provider uses, served over
 * real HTTP so the provider's fetch/abort/error handling is exercised as-is.
 * Shapes follow create-a-container/openapi.v1.yaml.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

export interface FakeService {
  id: number;
  type: 'http' | 'transport' | 'dns';
  internalPort: number;
  httpService?: { externalHostname: string; externalDomainId: number; backendProtocol: 'http' | 'https'; authRequired: boolean };
  transportService?: { protocol: 'tcp' | 'udp'; externalPort: number };
  dnsService?: { recordType: 'SRV'; dnsName: string };
}

export interface FakeContainer {
  id: number;
  hostname: string;
  owner: string;
  template: string;
  containerId: string | null;
  nvidiaRequested: boolean;
  entrypoint: string | null;
  environmentVars: Record<string, string>;
  services: FakeService[];
  collaborators?: string[];
  volumes: {
    id: number;
    name: string;
    mountPath: string;
    mode: 'ro' | 'rw';
    status?: 'pending' | 'ready' | 'failed';
    statusMessage?: string | null;
  }[];
  status?: string;
  creationJobId?: number | null;
}

export interface FakeJob {
  id: number;
  status: 'pending' | 'running' | 'success' | 'failure' | 'cancelled';
  polls: number;
  logs: string[];
  onSuccess?: () => void;
}

export interface RequestLog {
  method: string;
  path: string;
  body?: any;
}

export class FakeManager {
  readonly tokens = new Map<string, { user: string; keyId: string }>();
  readonly containers: FakeContainer[] = [];
  readonly jobs = new Map<number, FakeJob>();
  /** Rewrites a container in list responses (e.g. to serve a stale snapshot). */
  onList?: (c: ReturnType<FakeManager['serialize']>) => ReturnType<FakeManager['serialize']> | undefined;
  readonly requests: RequestLog[] = [];
  readonly domains = [{ id: 7, name: 'apps.example.test', siteId: 1 }];
  readonly siteId = 1;
  /** What GET /sites returns. */
  sites: { id: number; name: string }[] = [{ id: 1, name: 'site-one' }];
  nvidiaAvailable = false;
  /** Emulate a Manager that predates volumes (#421). */
  noVolumes = false;
  /** Status new volumes end up in once their job runs. */
  volumeOutcome: 'ready' | 'failed' = 'ready';
  /** Users treated as Manager admins (see and manage every container). */
  readonly admins = new Set<string>();
  /** Answer GET /jobs/:id with a 500 for this job id (Manager trouble). */
  failJobPolls?: number;
  /** Answer GET /session with a 500 for this token. */
  failSessionFor?: string;
  /** Answer DELETE /apikeys/:id with a 500 (Manager trouble). */
  failRevokes = false;
  /** Extra output line every new job logs (e.g. to check secret masking). */
  extraJobLog = '';
  /** Drop the connection for this many upcoming GET /jobs/:id requests. */
  dropJobPolls = 0;
  /** Status new jobs end in. */
  jobOutcome: FakeJob['status'] = 'success';
  /** Polls before a job leaves `running`. */
  jobPolls = 1;
  /** Called before POST /containers is processed (to simulate races). */
  beforeCreate?: (hostname: string) => void;
  /** Resolve GET /jobs/:id only after this promise (to test aborts). */
  jobGate?: Promise<void>;
  /** Handoff params the fake CLI-auth route will embed. */
  nextKey = { key: 'minted-key', id: 'key-2', user: 'alice' };
  /** One-time CLI sign-in codes → their state; and how many were redeemed. */
  readonly codes = new Map<string, string>();
  redeemed = 0;
  private readonly mintedFor = new Map<string, FakeManager['nextKey']>();
  /** Drop the connection after minting this many redemptions. */
  dropRedeems = 0;

  private nextId = 100;
  private nextVmid = 1000;
  private nextPort = 2000;
  private server = createServer((req, res) => {
    this.handle(req, res).catch((err) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'internal_error', message: String(err) } }));
    });
  });
  url = '';

  async start(): Promise<this> {
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', () => r()));
    const addr = this.server.address() as { port: number };
    this.url = `http://127.0.0.1:${addr.port}`;
    return this;
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((r) => this.server.close(() => r()));
  }

  addToken(token: string, user = 'alice', keyId = 'key-1'): void {
    this.tokens.set(token, { user, keyId });
  }

  seedContainer(c: Partial<FakeContainer> & { hostname: string }): FakeContainer {
    const full: FakeContainer = {
      id: this.nextId++,
      owner: 'alice',
      template: 'ghcr.io/mieweb/opensource-server/cloud:latest',
      containerId: String(this.nextVmid++),
      nvidiaRequested: false,
      entrypoint: null,
      environmentVars: {},
      services: [],
      volumes: [],
      ...c,
    };
    this.containers.push(full);
    return full;
  }

  /** A container another deploy is still creating: no VMID until its job succeeds. */
  seedCreating(hostname: string, opts: { withVmid?: boolean } = {}): FakeContainer {
    const job = this.newJob();
    // The real create job records the VMID as soon as the create is accepted.
    const c = this.seedContainer({
      hostname,
      containerId: opts.withVmid ? String(this.nextVmid++) : null,
      status: opts.withVmid ? undefined : 'creating',
      creationJobId: job.id,
    });
    const vmid = String(this.nextVmid++);
    job.onSuccess = () => {
      c.containerId ??= vmid;
      c.status = undefined;
    };
    return c;
  }

  /** A container whose create job already finished with failure (it may have a VMID). */
  seedFailedCreate(hostname: string): FakeContainer {
    const job = this.newJob();
    job.status = 'failure';
    return this.seedContainer({ hostname, creationJobId: job.id });
  }

  private newJob(): FakeJob {
    const logs = ['starting', ...(this.extraJobLog ? [this.extraJobLog] : []), 'done'];
    const job: FakeJob = { id: this.nextId++, status: 'pending', polls: 0, logs };
    this.jobs.set(job.id, job);
    return job;
  }

  serialize(c: FakeContainer) {
    const { volumes, ...rest } = c;
    return {
      ...rest,
      ...(this.noVolumes ? {} : { volumes }),
      status: c.status ?? (c.containerId ? 'running' : 'creating'),
      sshPort: c.services.find((s) => s.type === 'transport' && s.internalPort === 22)?.transportService?.externalPort ?? null,
      sshHost: 'ssh.example.test',
      httpEntries: c.services
        .filter((s) => s.type === 'http')
        .map((s) => {
          const d = this.domains.find((x) => x.id === s.httpService!.externalDomainId);
          return { port: s.internalPort, externalUrl: d ? `https://${s.httpService!.externalHostname}.${d.name}` : null };
        }),
      services: c.services.map((s) => ({ ...s, lastAccessedAt: null })),
    };
  }

  private addServices(c: FakeContainer, services: Record<string, any>): void {
    for (const s of Object.values(services ?? {})) {
      if (s.id || s.deleted) continue;
      const id = this.nextId++;
      if (s.type === 'http' || s.type === 'https') {
        c.services.push({
          id,
          type: 'http',
          internalPort: s.internalPort,
          httpService: {
            externalHostname: s.externalHostname,
            externalDomainId: s.externalDomainId,
            backendProtocol: s.type === 'https' ? 'https' : 'http',
            authRequired: !!s.authRequired,
          },
        });
      } else if (s.type === 'srv') {
        c.services.push({ id, type: 'dns', internalPort: s.internalPort, dnsService: { recordType: 'SRV', dnsName: s.dnsName } });
      } else {
        c.services.push({ id, type: 'transport', internalPort: s.internalPort, transportService: { protocol: s.type, externalPort: this.nextPort++ } });
      }
    }
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url!, 'http://x');
    const path = url.pathname.replace(/^\/api\/v1/, '');
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const ctype = req.headers['content-type'] ?? '';
    const body = raw ? (ctype.includes('json') ? JSON.parse(raw) : raw) : undefined;
    this.requests.push({ method: req.method!, path: `${path}${url.search}`, body });

    const send = (status: number, payload: unknown): void => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    };
    const ok = (data: unknown, status = 200): void => send(status, { data });
    const fail = (status: number, code: string, message = code): void => send(status, { error: { code, message } });

    if (req.method === 'GET' && path === '/health') return ok({ status: 'ok', oidcEnabled: false });

    // Browser-facing CLI handoff (the real route requires a session + confirm;
    // the fake just "approves" immediately).
    if (path === '/auth/cli/callback' && req.method === 'GET') {
      // Like the real route: only redirect to a loopback port, never to a
      // caller-chosen host.
      const port = Number(url.searchParams.get('port'));
      if (!Number.isInteger(port) || port < 1 || port > 65535) return fail(400, 'bad_port');
      const state = url.searchParams.get('state')!;
      // Like the real route: a one-time code, no key until it's redeemed.
      const code = `code-${this.nextId++}`;
      this.codes.set(code, state);
      const frag = new URLSearchParams({ code, state });
      res.writeHead(303, { Location: `http://127.0.0.1:${port}/callback#${frag}` });
      res.end();
      return;
    }
    if (path === '/auth/cli/token' && req.method === 'POST') {
      // Like the real route: a code mints one key; repeating it returns that key.
      const state = this.codes.get(body?.code);
      if (!state || state !== body?.state) {
        this.codes.delete(body?.code);
        return fail(400, 'invalid_code');
      }
      let minted = this.mintedFor.get(body.code);
      if (!minted) {
        this.redeemed += 1;
        minted = { ...this.nextKey };
        this.mintedFor.set(body.code, minted);
        this.tokens.set(minted.key, { user: minted.user, keyId: minted.id });
      }
      if (this.dropRedeems > 0) {
        this.dropRedeems -= 1;
        req.socket.destroy(); // the key exists, but the response is lost
        return;
      }
      return ok({ ...minted });
    }

    const auth = req.headers.authorization ?? '';
    const who = auth.startsWith('Bearer ') ? this.tokens.get(auth.slice(7)) : undefined;
    if (!who) return fail(401, 'unauthorized', 'Authentication required');

    if (req.method === 'GET' && path === '/session') {
      if (this.failSessionFor && auth === `Bearer ${this.failSessionFor}`) return fail(500, 'internal_error', 'boom');
      return ok({ user: who.user, isAdmin: false });
    }

    let m = /^\/apikeys\/([^/]+)$/.exec(path);
    if (m && req.method === 'DELETE') {
      if (this.failRevokes) return fail(500, 'internal_error', 'database unavailable');
      const id = decodeURIComponent(m[1]!);
      for (const [tok, v] of this.tokens) if (v.keyId === id) this.tokens.delete(tok);
      res.writeHead(204);
      res.end();
      return;
    }

    m = /^\/jobs\/(\d+)(\/status)?$/.exec(path);
    if (m && req.method === 'GET' && !m[2] && Number(m[1]) === this.failJobPolls) {
      return fail(500, 'internal_error', 'database unavailable');
    }
    if (m && req.method === 'GET' && !m[2] && this.dropJobPolls > 0) {
      this.dropJobPolls -= 1;
      req.socket.destroy();
      return;
    }
    if (m && req.method === 'GET') {
      const job = this.jobs.get(Number(m[1]));
      if (!job) return fail(404, 'not_found');
      if (m[2]) {
        const offset = Number(url.searchParams.get('offset') ?? 0);
        const rows = job.status === 'pending' ? [] : job.logs.map((output, i) => ({ id: i + 1, output }));
        return ok(rows.slice(offset));
      }
      if (this.jobGate) await this.jobGate;
      job.polls += 1;
      if (job.status === 'pending') job.status = 'running';
      else if (job.status === 'running' && job.polls > this.jobPolls) {
        job.status = this.jobOutcome;
        if (job.status === 'success') job.onSuccess?.();
      }
      return ok({ id: job.id, status: job.status });
    }

    if (path === '/sites' && req.method === 'GET') return ok(this.sites);

    m = /^\/sites\/(\d+)\/containers(?:\/(new|\d+))?$/.exec(path);
    if (!m) return fail(404, 'not_found');
    if (Number(m[1]) !== this.siteId) return fail(404, 'site_not_found');
    const sub = m[2];

    if (sub === 'new' && req.method === 'GET') {
      return ok({ siteId: this.siteId, externalDomains: this.domains, nvidiaAvailable: this.nvidiaAvailable });
    }
    if (!sub && req.method === 'GET') {
      const hostname = url.searchParams.get('hostname');
      return ok(
        this.containers
          .filter((c) => (c.owner === who.user || this.admins.has(who.user)) && (!hostname || c.hostname === hostname))
          .map((c) => this.onList?.(this.serialize(c)) ?? this.serialize(c)),
      );
    }
    if (!sub && req.method === 'POST') {
      this.beforeCreate?.(body.hostname);
      if (this.containers.some((c) => c.hostname === body.hostname)) return fail(409, 'conflict', 'hostname taken');
      const c: FakeContainer = {
        id: this.nextId++,
        hostname: body.hostname,
        // Like the Manager: admins may create on behalf of another user.
        owner: body.username && this.admins.has(who.user) ? body.username : who.user,
        collaborators: body.collaborators ?? [],
        template: body.template,
        containerId: null,
        nvidiaRequested: !!body.nvidiaRequested,
        entrypoint: body.entrypoint ?? null,
        environmentVars: Object.fromEntries((body.environmentVars ?? []).map((e: any) => [e.key, e.value])),
        services: [],
        volumes: this.noVolumes ? [] : (body.volumes ?? []).map((v: any) => ({ id: this.nextId++, ...v, status: this.volumeOutcome })),
      };
      this.addServices(c, body.services);
      this.containers.push(c);
      const job = this.newJob();
      // Provisioning "completes" (a VMID appears) when the job succeeds.
      const vmid = String(this.nextVmid++);
      job.onSuccess = () => {
        c.containerId = vmid;
      };
      return ok({ containerId: c.id, jobId: job.id, hostname: c.hostname, status: 'creating' }, 201);
    }

    const c = this.containers.find((x) => x.id === Number(sub));
    if (!c || (c.owner !== who.user && !this.admins.has(who.user))) return fail(404, 'not_found');
    if (req.method === 'GET') return ok(this.serialize(c));
    if (req.method === 'DELETE') {
      this.containers.splice(this.containers.indexOf(c), 1);
      return ok({ deleted: true, dnsWarnings: [] });
    }
    if (req.method === 'PUT') {
      for (const s of Object.values<any>(body.services ?? {})) {
        if (s.id && s.deleted) c.services = c.services.filter((x) => x.id !== s.id);
      }
      for (const s of Object.values<any>(body.services ?? {})) {
        if (s.id && !s.deleted) {
          const hit = c.services.find((x) => x.id === s.id);
          if (hit?.httpService) hit.httpService.authRequired = !!s.authRequired;
        }
      }
      this.addServices(c, body.services);
      c.environmentVars = Object.fromEntries((body.environmentVars ?? []).map((e: any) => [e.key, e.value]));
      c.entrypoint = body.entrypoint ?? null;
      for (const v of body.volumes ?? []) {
        if (v.detach) c.volumes = c.volumes.filter((x) => x.id !== v.id);
        else c.volumes.push({ id: this.nextId++, ...v, status: this.volumeOutcome });
      }
      const job = body.restart ? this.newJob() : null;
      return ok({ containerId: c.id, jobId: job?.id ?? null, dnsWarnings: [], pendingRestart: !body.restart });
    }
    return fail(405, 'method_not_allowed');
  }
}
