/**
 * Manager API client: `openapi-fetch` typed by the Manager's own OpenAPI spec
 * (`src/generated/manager-api.ts`), plus what the provider needs on top:
 * Bearer auth, `{ data }` envelope unwrapping, 401/403 → AuthError,
 * AbortSignal support, and retrying idempotent GETs on dropped connections.
 *
 * Only `Authorization: Bearer` is sent, no cookies, so the Manager's CSRF
 * guard skips these requests (middlewares/api.js).
 */

import { AuthError } from '@mieweb/deploy-contract';
import type { DeployTarget } from '@mieweb/deploy-contract';
import createClient, { type Client } from 'openapi-fetch';
import pRetry from 'p-retry';
import { LOGIN_HINT, PROVIDER_NAME } from './config.ts';
import type { paths } from './generated/manager-api.ts';

/** A non-auth error response from the Manager. */
export class ManagerApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** Per-field details from the error envelope (e.g. which columns of a 409 `conflict` collided). */
  readonly fields: Readonly<Record<string, string>>;
  constructor(status: number, code: string, message: string, fields: Record<string, string> = {}) {
    super(message);
    this.name = 'ManagerApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export interface ClientOptions {
  instanceUrl: string;
  token: string | null;
  target: DeployTarget;
  signal?: AbortSignal;
  fetch?: typeof fetch;
}

/** The `data` member of an endpoint's `{ data }` success envelope. */
type Envelope<T> = T extends { data?: infer D } ? D : never;

export type ManagerApi = Client<paths>;

export class ManagerClient {
  readonly instanceUrl: string;
  readonly target: DeployTarget;
  readonly api: ManagerApi;
  private readonly token: string | null;
  private readonly signal: AbortSignal | undefined;

  constructor(opts: ClientOptions) {
    this.instanceUrl = opts.instanceUrl;
    this.target = opts.target;
    this.token = opts.token;
    this.signal = opts.signal;
    const base = opts.fetch ?? globalThis.fetch;
    const signal = opts.signal;
    this.api = createClient<paths>({
      baseUrl: `${opts.instanceUrl}/api/v1`,
      headers: opts.token ? { Authorization: `Bearer ${opts.token}` } : {},
      // Idempotent requests are retried on network-level failures (a dropped
      // keep-alive socket mid job-poll shouldn't fail a deploy): GETs, and the
      // sign-in code redemption (the Manager returns the same key for a
      // repeated code, so a lost response doesn't leave an unseen key).
      // Other writes are never retried.
      fetch: (req: Request) => {
        const once = (): Promise<Response> => base(req.clone(), { signal, redirect: 'manual' });
        const idempotent = req.method === 'GET' || new URL(req.url).pathname.endsWith('/auth/cli/token');
        return idempotent ? pRetry(once, { retries: 3, minTimeout: 500, signal }) : once();
      },
    });
  }

  authError(): AuthError {
    return new AuthError(PROVIDER_NAME, this.target, LOGIN_HINT);
  }

  /**
   * Run one typed request and return the `data` payload of its envelope.
   *
   *   const site = await client.call((api) => api.GET('/sites/{id}', { params: { path: { id } } }));
   */
  async call<R extends { data?: unknown; error?: unknown; response: Response }>(
    request: (api: ManagerApi) => Promise<R>,
    opts: { auth?: boolean } = {},
  ): Promise<Envelope<NonNullable<R['data']>>> {
    if (opts.auth !== false && !this.token) throw this.authError();
    let result: R;
    try {
      result = await request(this.api);
    } catch (err) {
      if (this.signal?.aborted) throw this.signal.reason ?? err;
      if ((err as Error).name === 'AbortError') throw err;
      if (err instanceof SyntaxError) {
        throw new ManagerApiError(0, 'bad_response', `Unexpected non-JSON response from ${this.instanceUrl}`);
      }
      throw new Error(`Cannot reach the Manager at ${this.instanceUrl}: ${(err as Error).message}`, { cause: err });
    }
    const { response } = result;
    const where = `${new URL(response.url || this.instanceUrl).pathname}`;
    if (response.status === 401 || response.status === 403) throw this.authError();
    if (!response.ok) {
      const body = result.error as
        | { error?: { code?: string; message?: string; fields?: Record<string, string> } }
        | string
        | undefined;
      const e = typeof body === 'object' ? body?.error : undefined;
      const code = e?.code ?? `http_${response.status}`;
      const message = e?.message ?? (typeof body === 'string' && body ? body.slice(0, 200) : response.statusText);
      const fields = e?.fields && typeof e.fields === 'object' ? e.fields : {};
      throw new ManagerApiError(response.status, code, `${where} failed (${response.status} ${code}): ${message}`, fields);
    }
    return (result.data as { data?: unknown } | undefined)?.data as Envelope<NonNullable<R['data']>>;
  }
}
