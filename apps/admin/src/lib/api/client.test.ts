import { describe, expect, it, vi } from 'vitest';
import { apiError, createFetchMock, json } from '@/test/utils';
import { t } from '@/i18n';
import { ApiError, ReauthCancelledError, buildUrl, createApiClient } from './client';
import { apiFieldErrors, errorMessage } from './errors';

function client(handlers: Parameters<typeof createFetchMock>[0], opts: { token?: string | null; reauth?: () => Promise<string> } = {}) {
  const mock = createFetchMock(handlers);
  const onUnauthenticated = vi.fn();
  const reauthenticate = vi.fn(opts.reauth ?? (async () => 'fresh-token'));
  let token = opts.token === undefined ? 'tok-1' : opts.token;
  const c = createApiClient({ fetchImpl: mock.fetchMock, getCsrfToken: () => token, reauthenticate, onUnauthenticated });
  return { c, ...mock, onUnauthenticated, reauthenticate, setToken: (v: string | null) => (token = v) };
}

describe('api client', () => {
  it('sends X-CSRF-Token on mutations but not on GET', async () => {
    const { c, calls } = client({ 'GET /things': () => [], 'PUT /things/a': () => ({ ok: true }) });
    await c.get('/things');
    await c.put('/things/a', { x: 1 });
    expect(calls[0]!.headers['X-CSRF-Token']).toBeUndefined();
    expect(calls[1]!.headers['X-CSRF-Token']).toBe('tok-1');
    expect(calls[1]!.headers['Content-Type']).toBe('application/json');
    expect(calls[1]!.body).toEqual({ x: 1 });
  });

  it('re-authenticates before a mutation when the in-memory token was lost', async () => {
    const { c, calls, reauthenticate } = client({ 'POST /things': () => ({}) }, { token: null });
    await c.post('/things', {});
    expect(reauthenticate).toHaveBeenCalledOnce();
    expect(calls[0]!.headers['X-CSRF-Token']).toBe('fresh-token');
  });

  it('retries once with a fresh token after CSRF_INVALID', async () => {
    let n = 0;
    const { c, calls } = client({ 'DELETE /things/a': () => (n++ === 0 ? apiError(403, 'CSRF_INVALID') : json(204)) });
    await expect(c.del('/things/a')).resolves.toBeUndefined();
    expect(calls.map((x) => x.headers['X-CSRF-Token'])).toEqual(['tok-1', 'fresh-token']);
  });

  it('propagates a cancelled re-authentication as ReauthCancelledError', async () => {
    const { c, calls } = client({ 'POST /things': () => ({}) }, { token: null, reauth: () => Promise.reject(new ReauthCancelledError()) });
    await expect(c.post('/things', {})).rejects.toBeInstanceOf(ReauthCancelledError);
    expect(calls).toHaveLength(0);
    expect(errorMessage(new ReauthCancelledError())).toBe(t('auth.reauthCancelled'));
  });

  it('does not attach a token to login (skipCsrf)', async () => {
    const { c, calls, reauthenticate } = client({ 'POST /admin/auth/login': () => ({}) }, { token: null });
    await c.post('/admin/auth/login', {}, { skipCsrf: true, skipAuthRedirect: true });
    expect(reauthenticate).not.toHaveBeenCalled();
    expect(calls[0]!.headers['X-CSRF-Token']).toBeUndefined();
  });

  it('calls onUnauthenticated on 401 unless the request opts out', async () => {
    const { c, onUnauthenticated } = client({ 'GET /x': () => apiError(401, 'UNAUTHENTICATED') });
    await expect(c.get('/x')).rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
    expect(onUnauthenticated).toHaveBeenCalledOnce();
    await expect(c.request('GET', '/x', { skipAuthRedirect: true })).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthenticated).toHaveBeenCalledOnce();
  });

  it('maps error envelopes, unknown codes and network failures', async () => {
    const { c } = client({
      'GET /conflict': () => apiError(409, 'CONFLICT', { field: 'key' }),
      'GET /weird': () => apiError(422, 'SOMETHING_NEW'),
      'GET /html': () => new Response('<html>bad gateway</html>', { status: 502 }),
    });
    const conflict = await c.get('/conflict').catch((e: unknown) => e);
    expect(conflict).toMatchObject({ code: 'CONFLICT', status: 409, requestId: 'req-1', details: { field: 'key' } });
    expect(errorMessage(conflict)).toBe(t('errors.CONFLICT'));
    await expect(c.get('/weird')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(c.get('/html')).rejects.toMatchObject({ code: 'INTERNAL', status: 502 });

    const offline = createApiClient({ fetchImpl: vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch, getCsrfToken: () => 't', reauthenticate: async () => 't', onUnauthenticated: vi.fn() });
    const err = await offline.get('/x').catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'NETWORK_ERROR', status: 0 });
    expect(errorMessage(err)).toBe(t('errors.NETWORK_ERROR'));
    expect(errorMessage(new Error('boom'))).toBe(t('errors.UNKNOWN'));
  });

  it('maps server validation details onto field paths', () => {
    const err = new ApiError(400, 'VALIDATION_FAILED', 'x', [
      { path: 'translations', message: 'an "en" translation is required', code: 'custom' },
      { path: 'key', message: 'bad', code: 'invalid_format' },
    ]);
    expect(apiFieldErrors(err)).toEqual({ translations: t('validation.invalid'), key: t('validation.invalidFormat') });
  });

  it('builds query strings without empty values', () => {
    expect(buildUrl('/api', '/x', { a: 'b', c: undefined, d: '', e: 2 })).toBe('/api/x?a=b&e=2');
  });
});

describe('text responses', () => {
  it('returns the raw body for CSV exports', async () => {
    const fetchImpl = vi.fn(async () => new Response('a,b\n1,2\n', { status: 200, headers: { 'Content-Type': 'text/csv' } }));
    const client = createApiClient({ fetchImpl: fetchImpl as unknown as typeof fetch, getCsrfToken: () => null, reauthenticate: async () => 'x', onUnauthenticated: () => {} });
    await expect(client.getText('/admin/x.csv', { from: '2026-01-01' })).resolves.toBe('a,b\n1,2\n');
    expect(String((fetchImpl.mock.calls[0] as unknown[])[0])).toBe('/api/admin/x.csv?from=2026-01-01');
  });
});
