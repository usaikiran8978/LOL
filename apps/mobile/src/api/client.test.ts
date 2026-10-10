import type { AuthTokens } from '@amora/shared';
import { response, type MockResponse } from '../test/mockApi';
import { ApiClient } from './client';
import { ApiError, errorMessage } from './errors';
import type { TokenStore } from './tokenStore';

class MemoryTokens implements TokenStore {
  access: { token: string; expiresAt: number } | null = null;
  refresh: string | null = null;
  getAccess = () => this.access;
  getRefresh = async () => this.refresh;
  setTokens = async (t: AuthTokens) => {
    this.access = { token: t.accessToken, expiresAt: Date.parse(t.accessTokenExpiresAt) };
    this.refresh = t.refreshToken;
  };
  clear = async () => {
    this.access = null;
    this.refresh = null;
  };
}

const fresh = (n: number): AuthTokens => ({
  accessToken: `access-${n}`,
  accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
  refreshToken: `refresh-${n}`,
  refreshTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  sessionId: 's',
});

function setup(handler: (url: string, init: RequestInit) => MockResponse | Promise<MockResponse>) {
  const tokens = new MemoryTokens();
  const onSessionExpired = jest.fn();
  let id = 0;
  const fetchMock = jest.fn(async (url: string, init: RequestInit = {}) => {
    // Yield so concurrent callers genuinely overlap.
    await new Promise((r) => setTimeout(r, 5));
    return response(await handler(url, init));
  });
  const client = new ApiClient({ baseUrl: 'http://api.test/', tokens, fetch: fetchMock as unknown as typeof fetch, newRequestId: () => `rid-${++id}`, getLocale: () => 'ar', onSessionExpired });
  const refreshCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/v1/auth/refresh'));
  return { client, tokens, fetchMock, onSessionExpired, refreshCalls };
}

const auth = (init: RequestInit) => (init.headers as Record<string, string>).Authorization;

describe('ApiClient refresh', () => {
  it('serializes concurrent refreshes into a single /auth/refresh call (strict rotation)', async () => {
    let issued = 1;
    const { client, tokens, refreshCalls } = setup((url, init) => {
      if (url.endsWith('/auth/refresh')) return { body: fresh(++issued) };
      return auth(init) === 'Bearer access-2' ? { body: { ok: true } } : { status: 401, body: { error: { code: 'TOKEN_EXPIRED' } } };
    });
    tokens.refresh = 'refresh-1';
    tokens.access = { token: 'access-1', expiresAt: Date.now() - 1 }; // already expired

    const results = await Promise.all([client.get('/a'), client.get('/b'), client.get('/c'), client.get('/d')]);
    expect(results).toEqual(Array(4).fill({ ok: true }));
    expect(refreshCalls()).toHaveLength(1);
    expect(JSON.parse(String(refreshCalls()[0]![1]!.body))).toEqual({ refreshToken: 'refresh-1' });
    expect(tokens.refresh).toBe('refresh-2');
  });

  it('refreshes once when several in-flight requests are rejected with 401 at the same time', async () => {
    let issued = 1;
    const { client, tokens, refreshCalls } = setup((url, init) => {
      if (url.endsWith('/auth/refresh')) return { body: fresh(++issued) };
      return auth(init) === 'Bearer access-1' ? { status: 401, body: { error: { code: 'TOKEN_EXPIRED' } } } : { body: { who: auth(init) } };
    });
    tokens.refresh = 'refresh-1';
    tokens.access = { token: 'access-1', expiresAt: Date.now() + 600_000 }; // looks valid locally, server disagrees

    const results = await Promise.all([client.get('/x'), client.get('/y'), client.get('/z')]);
    expect(results).toEqual(Array(3).fill({ who: 'Bearer access-2' }));
    expect(refreshCalls()).toHaveLength(1);
  });

  it('does not retry or refresh on INVALID_CREDENTIALS', async () => {
    const { client, tokens, refreshCalls, fetchMock } = setup(() => ({ status: 401, body: { error: { code: 'INVALID_CREDENTIALS' } } }));
    tokens.refresh = 'refresh-1';
    tokens.access = { token: 'access-1', expiresAt: Date.now() + 600_000 };
    await expect(client.get('/x')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS', status: 401 });
    expect(refreshCalls()).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('signs out when the refresh token is rejected (reuse detected) and reports the reason', async () => {
    const { client, tokens, onSessionExpired } = setup((url) =>
      url.endsWith('/auth/refresh') ? { status: 401, body: { error: { code: 'REFRESH_TOKEN_REUSED' } } } : { status: 401, body: { error: { code: 'TOKEN_EXPIRED' } } },
    );
    tokens.refresh = 'refresh-1';
    tokens.access = { token: 'access-1', expiresAt: Date.now() - 1 };
    await expect(client.get('/x')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(onSessionExpired).toHaveBeenCalledWith('REFRESH_TOKEN_REUSED');
    expect(tokens.refresh).toBeNull();
  });

  it('keeps the refresh token when refresh fails for network reasons', async () => {
    const { client, tokens, onSessionExpired } = setup((url) => {
      if (url.endsWith('/auth/refresh')) throw new TypeError('Network request failed');
      return { body: {} };
    });
    tokens.refresh = 'refresh-1';
    await expect(client.get('/x')).rejects.toMatchObject({ code: 'NETWORK', status: 0 });
    expect(tokens.refresh).toBe('refresh-1');
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it('requires a session for authenticated calls and skips auth for public ones', async () => {
    const { client, fetchMock } = setup(() => ({ body: { ok: 1 } }));
    await expect(client.get('/users/me')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(client.get('/catalog/countries', { auth: 'none' })).resolves.toEqual({ ok: 1 });
    expect(auth(fetchMock.mock.calls[0]![1]!)).toBeUndefined();
  });
});

describe('ApiClient error mapping', () => {
  it('maps the error envelope to ApiError with code, details and request id', async () => {
    const { client } = setup(() => ({ status: 429, body: { error: { code: 'RATE_LIMITED', message: 'x', details: { retryAfterSeconds: 42 }, requestId: 'srv-1' } } }));
    const err = (await client.post('/auth/otp/request', {}, { auth: 'none' }).catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: 'RATE_LIMITED', status: 429, requestId: 'srv-1' });
    expect(err.retryAfterSeconds).toBe(42);
    expect(errorMessage(err)).toEqual({ key: 'errors.RATE_LIMITED_retry', params: { seconds: 42 } });
  });

  it('falls back safely for unknown codes, non-JSON bodies and network failures', async () => {
    const unknown = setup(() => ({ status: 400, body: { error: { code: 'SOMETHING_NEW' } } }));
    await expect(unknown.client.get('/x', { auth: 'none' })).rejects.toMatchObject({ code: 'INTERNAL', status: 400 });

    const html = setup(() => ({ status: 502 }));
    html.fetchMock.mockResolvedValueOnce({ ok: false, status: 502, headers: { get: () => null }, text: async () => '<html>bad gateway</html>' } as never);
    await expect(html.client.get('/x', { auth: 'none' })).rejects.toMatchObject({ code: 'INTERNAL', status: 502 });

    const offline = setup(() => {
      throw new TypeError('Network request failed');
    });
    await expect(offline.client.get('/x', { auth: 'none' })).rejects.toMatchObject({ code: 'NETWORK', status: 0, requestId: 'rid-1' });
  });

  it('sends a request id, the UI locale and JSON content type; 204 resolves to undefined', async () => {
    const { client, fetchMock } = setup(() => ({ status: 204 }));
    await expect(client.post('/auth/password/reset', { a: 1 }, { auth: 'none' })).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://api.test/v1/auth/password/reset');
    expect(init!.headers).toMatchObject({ 'X-Request-Id': 'rid-1', 'Accept-Language': 'ar', 'Content-Type': 'application/json' });
  });

  it('builds query strings and drops empty values', async () => {
    const { client, fetchMock } = setup(() => ({ body: [] }));
    await client.get('/catalog/cities', { auth: 'none', query: { q: 'Lon don', country: undefined, limit: 20 } });
    expect(fetchMock.mock.calls[0]![0]).toBe('http://api.test/v1/catalog/cities?q=Lon%20don&limit=20');
  });
});

describe('errorMessage', () => {
  it('uses localized keys with server-provided params', () => {
    expect(errorMessage(new ApiError('AGE_INELIGIBLE', 403, { minAge: 21 }))).toEqual({ key: 'errors.AGE_INELIGIBLE', params: { minAge: 21 } });
    expect(errorMessage(new ApiError('ONBOARDING_STEP_INVALID', 400, { step: 'photos', reason: 'onboarding.missing.photos' })).key).toBe('onboarding.missing.photos');
    expect(errorMessage(new ApiError('ONBOARDING_STEP_INVALID', 400, { reason: '<script>' })).key).toBe('errors.ONBOARDING_STEP_INVALID');
    expect(errorMessage(new Error('boom')).key).toBe('errors.INTERNAL');
  });
});
