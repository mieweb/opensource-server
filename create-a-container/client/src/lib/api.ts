/**
 * Typed JSON client for /api/v1. Handles:
 *  - cookies (session)
 *  - CSRF synchroniser token (fetched once, cached, sent on every mutation)
 *  - `{ data }` / `{ error }` envelope unwrapping
 *  - 401 → optional auth-failure handler (router decides what to do)
 *
 * CSRF policy: the synchroniser token is stored server-side in the session and
 * stays valid for the whole session lifetime. We fetch it exactly once and
 * reuse it for every mutation. A mutation NEVER goes out without a valid token
 * — if the cache is empty we await the token first. We deliberately do NOT
 * refresh on a 403 response: relying on forbidden responses to recover would
 * generate a stream of 4xx during failures and trip the backend rate limiter.
 * The cache is instead cleared proactively on auth-state changes (login/logout)
 * so the next mutation transparently fetches a token bound to the new session.
 */

export interface ApiErrorPayload {
  code: string;
  message: string;
  fields?: Record<string, string>;
}

export class ApiError extends Error {
  status: number;
  code: string;
  fields?: Record<string, string>;
  constructor(status: number, payload: ApiErrorPayload) {
    super(payload.message || `Request failed (${status})`);
    this.name = 'ApiError';
    this.status = status;
    this.code = payload.code || 'unknown';
    this.fields = payload.fields;
  }
}

let csrfToken: string | null = null;
let csrfTokenInFlight: Promise<string> | null = null;
let onUnauthorized: (() => void) | null = null;

export function setOnUnauthorized(fn: () => void) {
  onUnauthorized = fn;
}

async function fetchCsrfToken(): Promise<string> {
  const res = await fetch('/api/v1/csrf-token', { credentials: 'include' });
  if (!res.ok) throw new Error(`Failed to fetch CSRF token: ${res.status}`);
  const body = (await res.json()) as { data: { csrfToken: string } };
  csrfToken = body.data.csrfToken;
  return csrfToken;
}

/**
 * Resolve a valid CSRF token, returning the cached one when present. Concurrent
 * callers share a single in-flight request so a burst of mutations triggers at
 * most one token fetch rather than one per request.
 */
async function ensureCsrfToken(): Promise<string> {
  if (csrfToken) return csrfToken;
  if (!csrfTokenInFlight) {
    csrfTokenInFlight = fetchCsrfToken().finally(() => {
      csrfTokenInFlight = null;
    });
  }
  return csrfTokenInFlight;
}

export function clearCsrfToken() {
  csrfToken = null;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  /** Pass the raw Response back instead of parsing JSON (for SSE). */
  raw?: boolean;
  headers?: Record<string, string>;
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function apiRequest<T = unknown>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const method = options.method || 'GET';
  const isMutation = MUTATING_METHODS.has(method);

  // A mutation must never leave the client without a valid CSRF token.
  // ensureCsrfToken resolves the cached token or fetches one (deduplicated),
  // so by the time we build the request the header is guaranteed to be set.
  let token: string | null = null;
  if (isMutation) {
    token = await ensureCsrfToken();
  }

  const doFetch = async (): Promise<Response> => {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...options.headers,
    };
    if (options.body !== undefined && !(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }
    if (isMutation && token) headers['X-CSRF-Token'] = token;

    return fetch(path.startsWith('/') ? path : `/api/v1/${path}`, {
      method,
      credentials: 'include',
      signal: options.signal,
      headers,
      body:
        options.body === undefined
          ? undefined
          : options.body instanceof FormData
            ? options.body
            : JSON.stringify(options.body),
    });
  };

  const response = await doFetch();

  if (response.status === 401) {
    if (onUnauthorized) onUnauthorized();
    throw new ApiError(401, { code: 'unauthorized', message: 'Sign-in required' });
  }

  if (options.raw) return response as unknown as T;

  if (response.status === 204) return undefined as T;

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    if (!response.ok) {
      throw new ApiError(response.status, {
        code: 'http_error',
        message: `HTTP ${response.status}`,
      });
    }
    return undefined as T;
  }

  const body = (await response.json()) as
    | { data: T; meta?: unknown }
    | { error: ApiErrorPayload };

  if (!response.ok || 'error' in body) {
    const err = 'error' in body ? body.error : { code: 'unknown', message: 'Request failed' };
    throw new ApiError(response.status, err);
  }
  return body.data;
}

export const api = {
  get: <T>(path: string, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...opts, method: 'GET' }),
  post: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...opts, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...opts, method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...opts, method: 'PATCH', body }),
  delete: <T>(path: string, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...opts, method: 'DELETE' }),
};
