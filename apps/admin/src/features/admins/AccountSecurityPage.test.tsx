import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { t } from '@/i18n';
import { routerMock } from '@/test/setup';
import { apiError, json, renderSignedIn } from '@/test/utils';
import { AccountSecurityPage } from './AccountSecurityPage';
import { meAfterLogin, writesOf } from './testFixtures';

const setup = { secret: 'JBSWY3DPEHPK3PXP', otpauthUrl: 'otpauth://totp/Amora%20Admin:admin%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Amora%20Admin' };

beforeEach(() => routerMock.replace.mockReset());

describe('AccountSecurityPage', () => {
  it('enrols MFA: shows the secret, rejects a wrong code without signing out, then confirms', async () => {
    const user = userEvent.setup();
    let enabled = false;
    const me = meAfterLogin({ displayName: 'Ada', sessionExpiresAt: '2026-02-01T00:00:00Z', mfaSetupRequired: true });
    const { mutations: all } = await renderSignedIn(<AccountSecurityPage />, {
      'GET /admin/auth/me': () => {
        const r = me();
        return r instanceof Response ? r : { ...r, mfaEnabled: enabled, mfaSetupRequired: !enabled };
      },
      'POST /admin/auth/mfa/setup': () => setup,
      'POST /admin/auth/mfa/confirm': (c) => {
        if ((c.body as { code: string }).code !== '123456') return apiError(400, 'OTP_INVALID');
        enabled = true;
        return json(204);
      },
    });
    const mutations = writesOf(all);
    expect(await screen.findByText(t('admins.account.mfaDisabled'))).toBeInTheDocument();
    expect(screen.getByText(t('admins.account.mfaRequired'))).toBeInTheDocument();
    expect(screen.getByText('admin@example.com')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: t('admins.account.setup') }));
    expect(await screen.findByText(setup.secret)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: t('admins.account.openInApp') })).toHaveAttribute('href', setup.otpauthUrl);

    const code = screen.getByLabelText(t('admins.account.code'), { exact: false });
    await user.type(code, '12');
    await user.click(screen.getByRole('button', { name: t('admins.account.confirm') }));
    expect(mutations().filter((c) => c.path.endsWith('/confirm'))).toHaveLength(0);

    await user.clear(code);
    await user.type(code, '000000');
    await user.click(screen.getByRole('button', { name: t('admins.account.confirm') }));
    expect(await screen.findByText(t('admins.account.wrongCode'))).toBeInTheDocument();
    expect(routerMock.replace).not.toHaveBeenCalled();

    await user.clear(code);
    await user.type(code, '123456');
    await user.click(screen.getByRole('button', { name: t('admins.account.confirm') }));
    expect(await screen.findByText(t('admins.account.mfaEnabled'))).toBeInTheDocument();
    expect(mutations().map((c) => [c.path, c.body])).toEqual([
      ['/admin/auth/mfa/setup', undefined],
      ['/admin/auth/mfa/confirm', { code: '000000' }],
      ['/admin/auth/mfa/confirm', { code: '123456' }],
    ]);
    expect(mutations()[0]!.headers['X-CSRF-Token']).toBe('csrf-1');
    expect(screen.queryByText(setup.secret)).not.toBeInTheDocument();
  });

  it('turns MFA off after confirming with a current code', async () => {
    const user = userEvent.setup();
    let enabled = true;
    const me = meAfterLogin({ displayName: 'Ada', sessionExpiresAt: '2026-02-01T00:00:00Z', mfaSetupRequired: false });
    const { mutations: all } = await renderSignedIn(<AccountSecurityPage />, {
      'GET /admin/auth/me': () => {
        const r = me();
        return r instanceof Response ? r : { ...r, mfaEnabled: enabled };
      },
      'POST /admin/auth/mfa/disable': (c) => {
        if ((c.body as { code: string }).code !== '654321') return apiError(400, 'OTP_INVALID');
        enabled = false;
        return json(204);
      },
    });
    const mutations = writesOf(all);
    await user.click(await screen.findByRole('button', { name: t('admins.account.disable') }));
    const d = screen.getByRole('dialog', { name: t('admins.account.disableTitle') });
    await user.click(within(d).getByRole('button', { name: t('admins.account.disable') }));
    expect(within(d).getByText(t('validation.invalidFormat'))).toBeInTheDocument();
    expect(mutations()).toHaveLength(0);
    const code = within(d).getByLabelText(t('admins.account.code'), { exact: false });
    await user.type(code, '111111');
    await user.click(within(d).getByRole('button', { name: t('admins.account.disable') }));
    expect(await within(d).findByText(t('admins.account.wrongCode'))).toBeInTheDocument();
    expect(routerMock.replace).not.toHaveBeenCalled();
    await user.clear(code);
    await user.type(code, '654321');
    await user.click(within(d).getByRole('button', { name: t('admins.account.disable') }));
    expect(await screen.findByText(t('admins.account.mfaDisabled'))).toBeInTheDocument();
    expect(mutations().map((c) => c.body)).toEqual([{ code: '111111' }, { code: '654321' }]);
    expect(screen.getByText(t('admins.account.disabledDone'))).toBeInTheDocument();
  });

  it('refreshes instead of erroring when setup reports MFA already enabled', async () => {
    const user = userEvent.setup();
    let enabled = false;
    const me = meAfterLogin({ sessionExpiresAt: '2026-02-01T00:00:00Z', mfaSetupRequired: false });
    await renderSignedIn(<AccountSecurityPage />, {
      'GET /admin/auth/me': () => {
        const r = me();
        return r instanceof Response ? r : { ...r, mfaEnabled: enabled };
      },
      'POST /admin/auth/mfa/setup': () => {
        enabled = true;
        return apiError(409, 'CONFLICT');
      },
    });
    await user.click(await screen.findByRole('button', { name: t('admins.account.setup') }));
    expect(await screen.findByText(t('admins.account.mfaEnabled'))).toBeInTheDocument();
  });

  it('shows the error state and retries', async () => {
    const user = userEvent.setup();
    let calls = 0;
    await renderSignedIn(<AccountSecurityPage />, {
      'GET /admin/auth/me': () => {
        calls += 1;
        if (calls === 1) return apiError(401, 'UNAUTHENTICATED');
        if (calls === 3) return apiError(500, 'INTERNAL');
        return { id: 'a1', email: 'admin@example.com', permissions: [], countryScope: null, mfaEnabled: false, mfaSetupRequired: false, sessionExpiresAt: '2026-02-01T00:00:00Z' };
      },
    });
    expect(await screen.findByText(t('errors.INTERNAL'))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('common.retry') }));
    expect(await screen.findByText(t('admins.account.mfaDisabled'))).toBeInTheDocument();
    await waitFor(() => expect(calls).toBe(4));
  });
});
