import { ErrorCodes, type ErrorCode } from '@amora/shared';

export type ClientErrorCode = ErrorCode | 'NETWORK_ERROR';

/** Normalised API failure. `code` is always a known code so the UI can map it to a localized message. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ClientErrorCode,
    message: string,
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Rejects a pending mutation when the admin dismisses the re-authentication dialog. */
export class ReauthCancelledError extends ApiError {
  constructor() {
    super(403, 'CSRF_INVALID', 'Re-authentication cancelled');
    this.name = 'ReauthCancelledError';
  }
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';
export type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  query?: Record<string, QueryValue>;
  body?: unknown;
  /** Login is the only mutation made before a CSRF token exists. */
  skipCsrf?: boolean;
  /** Login/logout handle their own 401s (wrong password, MFA) instead of triggering session-expiry handling. */
  skipAuthRedirect?: boolean;
  signal?: AbortSignal;
  /** 'text' returns the raw body (CSV exports) instead of parsing JSON. */
  responseType?: 'json' | 'text';
}

export interface ApiClientOptions {
  /** Same-origin proxy prefix; Next.js rewrites `/api/*` to `${API_URL}/v1/*`. */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  getCsrfToken: () => string | null;
  /**
   * Obtains a fresh CSRF token by re-authenticating (the API has no CSRF refresh endpoint).
   * Rejects when the admin cancels.
   */
  reauthenticate: () => Promise<string>;
  /** Called when the session cookie is missing/expired so the app can route to login with a return URL. */
  onUnauthenticated: () => void;
}

export interface ApiClient {
  request<T>(method: HttpMethod, path: string, options?: RequestOptions): Promise<T>;
  get<T>(path: string, query?: Record<string, QueryValue>, signal?: AbortSignal): Promise<T>;
  post<T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'body'>): Promise<T>;
  put<T>(path: string, body: unknown): Promise<T>;
  del<T>(path: string): Promise<T>;
  /** GET returning the raw response text (e.g. CSV exports). */
  getText(path: string, query?: Record<string, QueryValue>): Promise<string>;
}

const KNOWN_CODES = new Set<string>(Object.keys(ErrorCodes));

function codeFromStatus(status: number): ErrorCode {
  if (status === 401) return 'UNAUTHENTICATED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 400 && status < 500) return 'VALIDATION_FAILED';
  return 'INTERNAL';
}

export function buildUrl(baseUrl: string, path: string, query?: Record<string, QueryValue>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }
  const q = qs.toString();
  return `${baseUrl}${path}${q ? `?${q}` : ''}`;
}

async function toApiError(res: Response): Promise<ApiError> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  const err = (body as { error?: { code?: string; message?: string; details?: unknown; requestId?: string } } | undefined)?.error;
  const code = err?.code && KNOWN_CODES.has(err.code) ? (err.code as ErrorCode) : codeFromStatus(res.status);
  return new ApiError(res.status, code, err?.message ?? res.statusText ?? code, err?.details, err?.requestId ?? res.headers.get('x-request-id') ?? undefined);
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const baseUrl = options.baseUrl ?? '/api';
  const doFetch = (...args: Parameters<typeof fetch>) => (options.fetchImpl ?? globalThis.fetch)(...args);

  async function send(method: HttpMethod, path: string, opts: RequestOptions, csrf: string | null): Promise<Response> {
    const headers: Record<string, string> = { Accept: opts.responseType === 'text' ? 'text/csv, text/plain, */*' : 'application/json' };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (csrf) headers['X-CSRF-Token'] = csrf;
    try {
      return await doFetch(buildUrl(baseUrl, path, opts.query), {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        // Same-origin proxy: the httpOnly admin cookie rides along; never sent cross-site.
        credentials: 'same-origin',
        cache: 'no-store',
        signal: opts.signal,
      });
    } catch (e) {
      if ((e as { name?: string }).name === 'AbortError') throw e;
      throw new ApiError(0, 'NETWORK_ERROR', 'Network request failed');
    }
  }

  async function request<T>(method: HttpMethod, path: string, opts: RequestOptions = {}): Promise<T> {
    const mutating = method !== 'GET';
    const needsCsrf = mutating && !opts.skipCsrf;
    let csrf = needsCsrf ? options.getCsrfToken() : null;
    // A reloaded tab keeps the cookie but loses the in-memory token; re-obtain it before the write.
    if (needsCsrf && !csrf) csrf = await options.reauthenticate();

    let res = await send(method, path, opts, csrf);
    let error = res.ok ? null : await toApiError(res);

    // Token rejected (e.g. session replaced in another tab): re-authenticate once and retry.
    if (error?.code === 'CSRF_INVALID' && needsCsrf) {
      csrf = await options.reauthenticate();
      res = await send(method, path, opts, csrf);
      error = res.ok ? null : await toApiError(res);
    }

    if (error) {
      if (error.status === 401 && !opts.skipAuthRedirect) options.onUnauthenticated();
      throw error;
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    if (opts.responseType === 'text') return text as T;
    return (text ? JSON.parse(text) : undefined) as T;
  }

  return {
    request,
    get: (path, query, signal) => request('GET', path, { query, signal }),
    post: (path, body, o) => request('POST', path, { ...o, body }),
    put: (path, body) => request('PUT', path, { body }),
    del: (path) => request('DELETE', path),
    getText: (path, query) => request<string>('GET', path, { query, responseType: 'text' }),
  };
}
