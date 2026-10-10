import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { t } from '@/i18n';
import { SessionProvider } from '@/lib/auth/session';
import { navigationState, routerMock } from '@/test/setup';
import { apiError, createFetchMock, field, json } from '@/test/utils';
import { AcceptInviteScreen } from './AcceptInviteScreen';

const TOKEN = 'tok_abcdefghijklmnopqrstuvwxyz0123456789';
const PASSWORD = 'a very long admin password';

function renderScreen(acceptHandler: Parameters<typeof createFetchMock>[0][string]) {
  const mock = createFetchMock({ 'GET /admin/auth/me': () => apiError(401, 'UNAUTHENTICATED'), 'POST /admin/auth/accept-invite': acceptHandler });
  render(<SessionProvider fetchImpl={mock.fetchMock}><AcceptInviteScreen /></SessionProvider>);
  return { ...mock, accepts: () => mock.calls.filter((c) => c.path === '/admin/auth/accept-invite') };
}

beforeEach(() => {
  routerMock.replace.mockReset();
  navigationState.search = `token=${encodeURIComponent(TOKEN)}`;
});

describe('AcceptInviteScreen', () => {
  it('validates the password locally, then activates the account without a CSRF token', async () => {
    const user = userEvent.setup();
    const { accepts } = renderScreen(() => json(204));
    await user.type(field(t('admins.acceptInvite.password')), 'short');
    await user.type(field(t('admins.acceptInvite.confirmPassword')), 'short');
    await user.click(screen.getByRole('button', { name: t('admins.acceptInvite.submit') }));
    expect(screen.getByText(t('validation.tooShort', { min: 14 }))).toBeInTheDocument();

    await user.clear(field(t('admins.acceptInvite.password')));
    await user.type(field(t('admins.acceptInvite.password')), PASSWORD);
    await user.clear(field(t('admins.acceptInvite.confirmPassword')));
    await user.type(field(t('admins.acceptInvite.confirmPassword')), `${PASSWORD}!`);
    await user.click(screen.getByRole('button', { name: t('admins.acceptInvite.submit') }));
    expect(screen.getByText(t('admins.acceptInvite.mismatch'))).toBeInTheDocument();
    expect(accepts()).toHaveLength(0);

    await user.clear(field(t('admins.acceptInvite.confirmPassword')));
    await user.type(field(t('admins.acceptInvite.confirmPassword')), PASSWORD);
    await user.click(screen.getByRole('button', { name: t('admins.acceptInvite.submit') }));
    expect(await screen.findByText(t('admins.acceptInvite.done'))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: t('admins.acceptInvite.goToLogin') })).toHaveAttribute('href', '/login');
    expect(accepts()).toHaveLength(1);
    expect(accepts()[0]!.body).toEqual({ token: TOKEN, password: PASSWORD });
    expect(accepts()[0]!.headers['X-CSRF-Token']).toBeUndefined();
  });

  it('explains an invalid or used invite without redirecting to sign-in', async () => {
    const user = userEvent.setup();
    renderScreen(() => apiError(401, 'TOKEN_INVALID'));
    await user.type(field(t('admins.acceptInvite.password')), PASSWORD);
    await user.type(field(t('admins.acceptInvite.confirmPassword')), PASSWORD);
    await user.click(screen.getByRole('button', { name: t('admins.acceptInvite.submit') }));
    expect(await screen.findByText(t('admins.acceptInvite.invalidToken'))).toBeInTheDocument();
    await waitFor(() => expect(routerMock.replace).not.toHaveBeenCalled());
  });

  it('shows other API errors (e.g. rate limiting)', async () => {
    const user = userEvent.setup();
    renderScreen(() => apiError(429, 'RATE_LIMITED'));
    await user.type(field(t('admins.acceptInvite.password')), PASSWORD);
    await user.type(field(t('admins.acceptInvite.confirmPassword')), PASSWORD);
    await user.click(screen.getByRole('button', { name: t('admins.acceptInvite.submit') }));
    expect(await screen.findByText(t('errors.RATE_LIMITED'))).toBeInTheDocument();
  });

  it('tells the user when the link has no token', () => {
    navigationState.search = '';
    renderScreen(() => json(204));
    expect(screen.getByText(t('admins.acceptInvite.missingToken'))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('admins.acceptInvite.submit') })).not.toBeInTheDocument();
  });
});
