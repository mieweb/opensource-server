/**
 * Typed JSON client for /api/v1. Handles:
 *  - cookies (session)
 *  - CSRF double-submit token (fetched on demand, cached, refreshed on 403)
 *  - `{ data }` / `{ error }` envelope unwrapping
 *  - 401 → optional auth-failure handler (router decides what to do)
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

  if (isMutation && !csrfToken) {
    await fetchCsrfToken();
  }

  const doFetch = async (): Promise<Response> => {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...options.headers,
    };
    if (options.body !== undefined && !(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }
    if (isMutation && csrfToken) headers['X-CSRF-Token'] = csrfToken;

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

  let response = await doFetch();

  // CSRF token may have rotated; retry once.
  if (response.status === 403 && isMutation) {
    const text = await response.clone().text();
    if (text.includes('csrf') || text.includes('CSRF')) {
      await fetchCsrfToken();
      response = await doFetch();
    }
  }

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
