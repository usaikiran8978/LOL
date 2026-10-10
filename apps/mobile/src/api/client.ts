import type { AuthTokens, ErrorCode } from '@amora/shared';
import { ApiError, normalizeCode } from './errors';
import type { TokenStore } from './tokenStore';

export type AuthMode = 'required' | 'optional' | 'none';
export type Query = Record<string, string | number | boolean | undefined | null>;

export interface RequestOptions {
  body?: unknown;
  query?: Query;
  auth?: AuthMode;
  signal?: AbortSignal;
}

export interface ApiClientOptions {
  baseUrl: string;
  tokens: TokenStore;
  fetch?: typeof fetch;
  getLocale?: () => string;
  newRequestId: () => string;
  /** Called once when the session can no longer be refreshed (revoked, expired, reuse detected). */
  onSessionExpired?: (code: ErrorCode) => void;
  timeoutMs?: number;
}

// Refresh this long before expiry so a request never races the access token's last seconds.
const EXPIRY_SKEW_MS = 30_000;
// 401 codes that a fresh access token can fix. INVALID_CREDENTIALS etc. are real answers, not stale tokens.
const REFRESHABLE = new Set(['TOKEN_EXPIRED', 'TOKEN_INVALID', 'UNAUTHENTICATED']);

function fallbackCode(status: number): ErrorCode {
  if (status === 401) return 'UNAUTHENTICATED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 400 && status < 500) return 'VALIDATION_FAILED';
  return 'INTERNAL';
}

/** React Native's Blob has no arrayBuffer(); FileReader.readAsArrayBuffer works on both RN and the web/test Blob. */
function blobBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

/**
 * Typed fetch wrapper for the `/v1` API.
 *
 * The server rotates refresh tokens strictly and treats a second use of the same refresh token as theft (it revokes
 * the whole token family). Two concurrent refreshes from this device would therefore log the user out, so every
 * refresh goes through one shared in-flight promise.
 */
export class ApiClient {
  private inflightRefresh: Promise<string | null> | null = null;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: ApiClientOptions) {
    this.fetchImpl = opts.fetch ?? ((...args) => fetch(...args));
  }

  get<T>(path: string, o?: Omit<RequestOptions, 'body'>) {
    return this.request<T>('GET', path, o);
  }
  post<T>(path: string, body?: unknown, o?: Omit<RequestOptions, 'body'>) {
    return this.request<T>('POST', path, { ...o, body });
  }
  put<T>(path: string, body?: unknown, o?: Omit<RequestOptions, 'body'>) {
    return this.request<T>('PUT', path, { ...o, body });
  }
  delete<T = void>(path: string, o?: Omit<RequestOptions, 'body'>) {
    return this.request<T>('DELETE', path, o);
  }

  async request<T>(method: string, path: string, o: RequestOptions = {}): Promise<T> {
    const auth = o.auth ?? 'required';
    const token = auth === 'none' ? null : await this.accessToken(auth === 'required');
    try {
      return await this.send<T>(method, path, o, token);
    } catch (e) {
      if (auth === 'none' || !(e instanceof ApiError) || e.status !== 401 || !REFRESHABLE.has(e.code)) throw e;
      const fresh = await this.tokenAfterRejection(token);
      if (!fresh) throw e;
      return this.send<T>(method, path, o, fresh);
    }
  }

  /** Persist a fresh session (login, register, social, recovery). */
  async setSession(tokens: AuthTokens): Promise<void> {
    await this.opts.tokens.setTokens(tokens);
  }

  async clearSession(): Promise<void> {
    await this.opts.tokens.clear();
  }

  async hasSession(): Promise<boolean> {
    return !!this.opts.tokens.getAccess() || !!(await this.opts.tokens.getRefresh());
  }

  /** Single-flight refresh. Resolves to the new access token, or null when the session is gone. */
  refresh(): Promise<string | null> {
    if (!this.inflightRefresh) {
      this.inflightRefresh = this.doRefresh().finally(() => {
        this.inflightRefresh = null;
      });
    }
    return this.inflightRefresh;
  }

  /**
   * A currently valid access token for non-HTTP transports (the chat WebSocket authenticates with its first frame).
   * Goes through the same single-flight refresh as HTTP requests, so a socket reconnect never races a request.
   */
  freshAccessToken(): Promise<string | null> {
    return this.accessToken(false);
  }

  /** After a transport rejected `used` as expired/invalid: reuse a token another caller already refreshed, else refresh. */
  accessTokenAfterRejection(used: string | null): Promise<string | null> {
    return this.tokenAfterRejection(used);
  }

  /** Base URL of the realtime endpoint (`ws(s)://host/v1/ws`). */
  get websocketUrl(): string {
    return `${this.opts.baseUrl.replace(/\/+$/, '').replace(/^http/, 'ws')}/v1/ws`;
  }

  /** Raw upload to a pre-signed object-storage URL (no API auth header, no /v1 prefix). */
  async upload(url: string, method: string, headers: Record<string, string>, body: Blob): Promise<void> {
    let res: Response;
    try {
      // Send raw bytes, not the Blob: Expo's fetch replaces Content-Type with blob.type (often '' or 'image/heic' for
      // picked photos), which breaks the signed Content-Type and makes storage reject the upload.
      res = await this.fetchImpl(url, { method, headers, body: await blobBytes(body) });
    } catch {
      throw new ApiError('NETWORK', 0);
    }
    if (!res.ok) throw new ApiError('MEDIA_NOT_UPLOADED', res.status);
  }

  private async accessToken(required: boolean): Promise<string | null> {
    const current = this.opts.tokens.getAccess();
    if (current && current.expiresAt - Date.now() > EXPIRY_SKEW_MS) return current.token;
    if (await this.opts.tokens.getRefresh()) {
      const fresh = await this.refresh();
      if (fresh) return fresh;
    }
    if (required) throw new ApiError('UNAUTHENTICATED', 401);
    return null;
  }

  private async tokenAfterRejection(used: string | null): Promise<string | null> {
    // Another request may already have refreshed while this one was in flight; reuse its token instead of
    // spending the (already rotated) refresh token again.
    const current = this.opts.tokens.getAccess();
    if (current && current.token !== used && current.expiresAt - Date.now() > EXPIRY_SKEW_MS) return current.token;
    return this.refresh();
  }

  private async doRefresh(): Promise<string | null> {
    const refreshToken = await this.opts.tokens.getRefresh();
    if (!refreshToken) return null;
    try {
      const tokens = await this.send<AuthTokens>('POST', '/auth/refresh', { body: { refreshToken } }, null);
      await this.opts.tokens.setTokens(tokens);
      return tokens.accessToken;
    } catch (e) {
      // Network/5xx: keep the refresh token so the next attempt can succeed. Any 4xx means it is dead.
      if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.code !== 'RATE_LIMITED') {
        await this.opts.tokens.clear();
        this.opts.onSessionExpired?.(e.code as ErrorCode);
        return null;
      }
      throw e;
    }
  }

  private url(path: string, query?: Query): string {
    const base = this.opts.baseUrl.replace(/\/+$/, '');
    const qs = query
      ? Object.entries(query)
          .filter(([, v]) => v !== undefined && v !== null && v !== '')
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
          .join('&')
      : '';
    return `${base}/v1${path}${qs ? `?${qs}` : ''}`;
  }

  private async send<T>(method: string, path: string, o: RequestOptions, token: string | null): Promise<T> {
    const requestId = this.opts.newRequestId();
    const headers: Record<string, string> = { Accept: 'application/json', 'X-Request-Id': requestId };
    const locale = this.opts.getLocale?.();
    if (locale) headers['Accept-Language'] = locale;
    if (token) headers.Authorization = `Bearer ${token}`;
    if (o.body !== undefined) headers['Content-Type'] = 'application/json';

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    o.signal?.addEventListener('abort', onAbort);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.opts.timeoutMs ?? 20_000);

    let res: Response;
    try {
      res = await this.fetchImpl(this.url(path, o.query), {
        method,
        headers,
        body: o.body === undefined ? undefined : JSON.stringify(o.body),
        signal: controller.signal,
      });
    } catch {
      throw new ApiError(timedOut ? 'TIMEOUT' : 'NETWORK', 0, undefined, requestId);
    } finally {
      clearTimeout(timer);
      o.signal?.removeEventListener('abort', onAbort);
    }

    const echoedId = res.headers?.get?.('x-request-id') ?? requestId;
    if (res.status === 204) return undefined as T;
    let json: unknown;
    try {
      const text = await res.text();
      json = text ? JSON.parse(text) : undefined;
    } catch {
      throw new ApiError(res.ok ? 'BAD_RESPONSE' : fallbackCode(res.status), res.status, undefined, echoedId);
    }
    if (!res.ok) {
      const err = (json as { error?: { code?: unknown; details?: unknown; requestId?: string } } | undefined)?.error;
      throw new ApiError(err?.code ? normalizeCode(err.code) : fallbackCode(res.status), res.status, err?.details, err?.requestId ?? echoedId);
    }
    return json as T;
  }
}
