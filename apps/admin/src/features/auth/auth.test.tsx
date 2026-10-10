import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { ConsoleShell } from '@/components/shell/ConsoleShell';
import { t } from '@/i18n';
import { SessionProvider, safeReturnTo, useAdminApi } from '@/lib/auth/session';
import { navigationState, routerMock } from '@/test/setup';
import { apiError, createFetchMock, field, json } from '@/test/utils';
import { LoginScreen } from './LoginScreen';

const me = { id: 'a1', email: 'admin@example.com', permissions: ['audit.view'], countryScope: null };
const loginOk = { admin: { ...me, displayName: 'Ada', mfaEnabled: true }, csrfToken: 'csrf-1', expiresAt: '2030-01-01T00:00:00.000Z' };

beforeEach(() => {
  routerMock.replace.mockReset();
  navigationState.pathname = '/';
  navigationState.search = '';
  window.history.replaceState(null, '', '/');
});

describe('login', () => {
  it('asks for a TOTP code on MFA_REQUIRED and returns to the requested page', async () => {
    navigationState.search = 'returnTo=%2Fconfig%2Fflags';
    let signedIn = false;
    const { fetchMock, calls } = createFetchMock({
      'GET /admin/auth/me': () => (signedIn ? me : apiError(401, 'UNAUTHENTICATED')),
      'POST /admin/auth/login': (c) => {
        const body = c.body as { totp?: string };
        if (!body.totp) return apiError(401, 'MFA_REQUIRED');
        signedIn = true;
        return loginOk;
      },
    });
    const user = userEvent.setup();
    render(<SessionProvider fetchImpl={fetchMock}><LoginScreen /></SessionProvider>);
    await user.type(field(t('auth.email')), 'admin@example.com');
    await user.type(field(t('auth.password')), 'correct horse');
    await user.click(screen.getByRole('button', { name: t('auth.submit') }));
    const totp = await screen.findByLabelText(new RegExp(t('auth.totp')));
    await user.type(totp, '123456');
    await user.click(screen.getByRole('button', { name: t('auth.submit') }));
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/config/flags'));
    const logins = calls.filter((c) => c.path === '/admin/auth/login');
    expect(logins.map((c) => c.body)).toEqual([
      { email: 'admin@example.com', password: 'correct horse' },
      { email: 'admin@example.com', password: 'correct horse', totp: '123456' },
    ]);
    expect(logins[0]!.headers['X-CSRF-Token']).toBeUndefined();
  });

  it('validates input client-side and maps INVALID_CREDENTIALS', async () => {
    const { fetchMock, calls } = createFetchMock({
      'GET /admin/auth/me': () => apiError(401, 'UNAUTHENTICATED'),
      'POST /admin/auth/login': () => apiError(401, 'INVALID_CREDENTIALS'),
    });
    const user = userEvent.setup();
    render(<SessionProvider fetchImpl={fetchMock}><LoginScreen /></SessionProvider>);
    await user.click(screen.getByRole('button', { name: t('auth.submit') }));
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    await user.type(field(t('auth.email')), 'admin@example.com');
    await user.type(field(t('auth.password')), 'wrong');
    await user.click(screen.getByRole('button', { name: t('auth.submit') }));
    expect(await screen.findByText(t('errors.INVALID_CREDENTIALS'))).toBeInTheDocument();
    expect(routerMock.replace).not.toHaveBeenCalled();
  });

  it('shows the session-expired notice', () => {
    navigationState.search = 'reason=expired';
    const { fetchMock } = createFetchMock({ 'GET /admin/auth/me': () => apiError(401, 'UNAUTHENTICATED') });
    render(<SessionProvider fetchImpl={fetchMock}><LoginScreen /></SessionProvider>);
    expect(screen.getByText(t('auth.sessionExpired'))).toBeInTheDocument();
  });

  it('only accepts same-origin return paths', () => {
    expect(safeReturnTo('/geo/cities?q=a')).toBe('/geo/cities?q=a');
    expect(safeReturnTo('//evil.example')).toBe('/');
    expect(safeReturnTo('https://evil.example')).toBe('/');
    expect(safeReturnTo('/\\evil.example')).toBe('/');
    expect(safeReturnTo(null)).toBe('/');
  });
});

describe('session handling', () => {
  it('redirects to login with a return URL when there is no session', async () => {
    window.history.replaceState(null, '', '/audit-logs?action=x');
    navigationState.pathname = '/audit-logs';
    const { fetchMock } = createFetchMock({ 'GET /admin/auth/me': () => apiError(401, 'UNAUTHENTICATED') });
    render(<SessionProvider fetchImpl={fetchMock}><ConsoleShell><p>page</p></ConsoleShell></SessionProvider>);
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/login?returnTo=%2Faudit-logs%3Faction%3Dx'));
    expect(screen.queryByText('page')).toBeNull();
  });

  it('re-authenticates in place when the CSRF token is missing, then completes the write', async () => {
    let csrfIssued = false;
    const { fetchMock, calls } = createFetchMock({
      'GET /admin/auth/me': () => me,
      'POST /admin/auth/login': () => {
        csrfIssued = true;
        return loginOk;
      },
      'DELETE /admin/content/cms/faq.x': (c) => (csrfIssued && c.headers['X-CSRF-Token'] === 'csrf-1' ? json(204) : apiError(403, 'CSRF_INVALID')),
    });
    function Writer() {
      const api = useAdminApi();
      return <button type="button" onClick={() => void api.content.archiveCms('faq.x').then(() => document.body.append('archived-ok'))}>write</button>;
    }
    const user = userEvent.setup();
    render(<SessionProvider fetchImpl={fetchMock}><ConsoleShell><Writer /></ConsoleShell></SessionProvider>);
    expect(await screen.findByText(t('auth.readOnlySession'))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'write' }));
    const dialog = await screen.findByRole('dialog', { name: t('auth.reauthTitle') });
    expect(field(t('auth.email'))).toHaveValue('admin@example.com');
    await user.type(field(t('auth.password')), 'pw');
    await user.click(screen.getByRole('button', { name: t('auth.reauthSubmit') }));
    await waitFor(() => expect(document.body).toHaveTextContent('archived-ok'));
    expect(dialog).not.toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
  });

  it('routes to login with reason=expired when the session dies mid-use', async () => {
    window.history.replaceState(null, '', '/content/cms');
    let alive = true;
    const { fetchMock } = createFetchMock({
      'GET /admin/auth/me': () => me,
      'GET /admin/content/cms': () => (alive ? [] : apiError(401, 'UNAUTHENTICATED')),
    });
    function Reader() {
      const api = useAdminApi();
      return <button type="button" onClick={() => void api.content.cms().catch(() => {})}>read</button>;
    }
    const user = userEvent.setup();
    render(<SessionProvider fetchImpl={fetchMock}><ConsoleShell><Reader /></ConsoleShell></SessionProvider>);
    alive = false;
    await user.click(await screen.findByRole('button', { name: 'read' }));
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/login?returnTo=%2Fcontent%2Fcms&reason=expired'));
  });

  it('signs out (re-authenticating first when the token was lost) and returns to the login page', async () => {
    const { fetchMock, calls } = createFetchMock({
      'GET /admin/auth/me': () => me,
      'POST /admin/auth/login': () => loginOk,
      'POST /admin/auth/logout': (c) => (c.headers['X-CSRF-Token'] === 'csrf-1' ? json(204) : apiError(403, 'CSRF_INVALID')),
    });
    const user = userEvent.setup();
    render(<SessionProvider fetchImpl={fetchMock}><ConsoleShell><p>page</p></ConsoleShell></SessionProvider>);
    await user.click(await screen.findByRole('button', { name: t('auth.signOut') }));
    await user.type(field(t('auth.password')), 'pw');
    await user.click(screen.getByRole('button', { name: t('auth.reauthSubmit') }));
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/login?reason=signedout'));
    expect(calls.filter((c) => c.path === '/admin/auth/logout')).toHaveLength(1);
  });

  it('cancelling re-authentication keeps the admin signed in', async () => {
    const { fetchMock } = createFetchMock({ 'GET /admin/auth/me': () => me });
    const user = userEvent.setup();
    render(<SessionProvider fetchImpl={fetchMock}><ConsoleShell><p>page</p></ConsoleShell></SessionProvider>);
    await user.click(await screen.findByRole('button', { name: t('auth.signOut') }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: t('common.cancel') }));
    expect(screen.getByText('page')).toBeInTheDocument();
    expect(routerMock.replace).not.toHaveBeenCalled();
  });
});

describe('session load failure', () => {
  it('shows a mapped error with retry when the API is unreachable', async () => {
    let up = false;
    const { fetchMock } = createFetchMock({ 'GET /admin/auth/me': () => (up ? me : apiError(503, 'INTERNAL')) });
    const user = userEvent.setup();
    render(<SessionProvider fetchImpl={fetchMock}><ConsoleShell><p>page</p></ConsoleShell></SessionProvider>);
    expect(await screen.findByText(t('errors.INTERNAL'))).toBeInTheDocument();
    up = true;
    await user.click(screen.getByRole('button', { name: t('common.retry') }));
    expect(await screen.findByText('page')).toBeInTheDocument();
  });
});
