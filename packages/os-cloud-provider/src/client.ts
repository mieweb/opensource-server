/**
 * Minimal Manager API client: Bearer auth, `{ data }` / `{ error }` envelope
 * unwrapping, AbortSignal support, and 401/403 → AuthError.
 *
 * Only `Authorization: Bearer` is sent — no cookies — so the Manager's CSRF
 * guard skips these requests (middlewares/api.js).
 */

import { AuthError } from '@mieweb/deploy-contract';
import type { DeployTarget } from '@mieweb/deploy-contract';
import { LOGIN_HINT, PROVIDER_NAME } from './config.ts';
import { sleep } from './jobs.ts';

const RETRIES = 3;
const RETRY_DELAY_MS = 500;

/** A non-auth error response from the Manager. */
export class ManagerApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ManagerApiError';
    this.status = status;
    this.code = code;
  }
}

export interface ClientOptions {
  instanceUrl: string;
  token: string | null;
  target: DeployTarget;
  signal?: AbortSignal;
  fetch?: typeof fetch;
}

type Query = Record<string, string | number | undefined>;

export class ManagerClient {
  readonly instanceUrl: string;
  readonly target: DeployTarget;
  private readonly token: string | null;
  private readonly signal: AbortSignal | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: ClientOptions) {
    this.instanceUrl = opts.instanceUrl;
    this.target = opts.target;
    this.token = opts.token;
    this.signal = opts.signal;
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
  }

  private url(path: string, query?: Query): string {
    const u = new URL(`${this.instanceUrl}/api/v1${path}`);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined) u.searchParams.set(k, String(v));
    }
    return u.toString();
  }

  authError(): AuthError {
    return new AuthError(PROVIDER_NAME, this.target, LOGIN_HINT);
  }

  /** Perform a request and return the unwrapped `data` payload. */
  async request<T>(method: string, path: string, opts: { body?: unknown; query?: Query; auth?: boolean } = {}): Promise<T> {
    const needsAuth = opts.auth !== false;
    if (needsAuth && !this.token) throw this.authError();

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (needsAuth && this.token) headers.Authorization = `Bearer ${this.token}`;
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

    // GETs are idempotent, so retry them on connection-level failures (a
    // dropped keep-alive socket mid job-poll shouldn't fail a deploy).
    // Writes are never retried.
    const attempts = method === 'GET' ? RETRIES + 1 : 1;
    let res!: Response;
    for (let attempt = 1; ; attempt += 1) {
      try {
        res = await this.fetchImpl(this.url(path, opts.query), {
          method,
          headers,
          body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
          signal: this.signal,
          redirect: 'manual',
        });
        break;
      } catch (err) {
        if ((err as Error).name === 'AbortError' || this.signal?.aborted) throw err;
        if (attempt < attempts) {
          await sleep(RETRY_DELAY_MS * attempt, this.signal ?? new AbortController().signal);
          continue;
        }
        throw new Error(`Cannot reach the Manager at ${this.instanceUrl}: ${(err as Error).message}`, { cause: err });
      }
    }

    if (res.status === 401 || res.status === 403) {
      await res.body?.cancel();
      throw this.authError();
    }
    if (res.status === 204) return undefined as T;

    const text = await res.text();
    let json: { data?: unknown; error?: { code?: string; message?: string } } | undefined;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    if (!res.ok) {
      const code = json?.error?.code ?? `http_${res.status}`;
      const message = json?.error?.message ?? (text.slice(0, 200) || res.statusText);
      throw new ManagerApiError(res.status, code, `${method} ${path} failed (${res.status} ${code}): ${message}`);
    }
    if (json === undefined || !('data' in json)) {
      throw new ManagerApiError(res.status, 'bad_response', `${method} ${path}: unexpected non-JSON response from ${this.instanceUrl}`);
    }
    return json.data as T;
  }

  get<T>(path: string, query?: Query): Promise<T> {
    return this.request<T>('GET', path, { query });
  }
  post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, { body });
  }
  put<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('PUT', path, { body });
  }
  delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }
}
