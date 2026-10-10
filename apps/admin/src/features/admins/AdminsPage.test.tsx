import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { t } from '@/i18n';
import { apiError, field, json, renderSignedIn } from '@/test/utils';
import { AdminsPage } from './AdminsPage';
import { adminRows, roleRows, writesOf } from './testFixtures';

const base = {
  'GET /admin/admins': () => adminRows,
  'GET /admin/roles': () => roleRows,
};

const rowOf = (email: string) => screen.getByRole('cell', { name: new RegExp(`^${email.replace('.', '\\.')}`) }).closest('tr')!;

describe('AdminsPage', () => {
  it('lists admins with roles, country scope, MFA, status and last sign-in', async () => {
    await renderSignedIn(<AdminsPage />, base);
    expect(await screen.findByText('bob@example.com')).toBeInTheDocument();
    const carol = rowOf('carol@example.com');
    expect(within(carol).getByText(t('admins.roleNames.support'))).toBeInTheDocument();
    expect(within(carol).getByText(t('admins.list.scopedTo', { countries: 'IN, US' }))).toBeInTheDocument();
    expect(within(carol).getByText(t('admins.list.mfaOn'))).toBeInTheDocument();
    const bob = rowOf('bob@example.com');
    expect(within(bob).getByText(t('admins.status.disabled'))).toBeInTheDocument();
    expect(within(bob).getByText('People ops')).toBeInTheDocument();
    expect(within(bob).getByText(t('admins.list.never'))).toBeInTheDocument();
    expect(within(bob).getByText(t('admins.list.mfaOff'))).toBeInTheDocument();
    expect(bob).toHaveClass('is-danger');
    // Disabled admins can be enabled, not disabled; MFA reset only when MFA is on.
    expect(within(bob).getByRole('button', { name: `${t('admins.ops.enable')} bob@example.com` })).toBeInTheDocument();
    expect(within(bob).queryByRole('button', { name: `${t('admins.ops.resetMfa')} bob@example.com` })).not.toBeInTheDocument();
    // The signed-in admin cannot disable themselves.
    const self = rowOf('admin@example.com');
    expect(within(self).getByText(t('admins.list.you'))).toBeInTheDocument();
    expect(within(self).getByRole('button', { name: new RegExp(t('admins.ops.disable')) })).toBeDisabled();
  });

  it('shows the empty state', async () => {
    await renderSignedIn(<AdminsPage />, { ...base, 'GET /admin/admins': () => [] });
    expect(await screen.findByText(t('admins.list.empty'))).toBeInTheDocument();
  });

  it('shows the error state and retries', async () => {
    let fail = true;
    const user = userEvent.setup();
    await renderSignedIn(<AdminsPage />, { ...base, 'GET /admin/admins': () => (fail ? apiError(500, 'INTERNAL') : adminRows) });
    expect(await screen.findByText(t('errors.INTERNAL'))).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: t('common.retry') }));
    expect(await screen.findByText('bob@example.com')).toBeInTheDocument();
  });

  it('is forbidden without admins.manage and makes no requests', async () => {
    const { calls } = await renderSignedIn(<AdminsPage />, base, ['users.view']);
    expect(screen.getByText(t('states.forbiddenTitle'))).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/admin/admins')).toBe(false);
    expect(screen.queryByRole('button', { name: t('admins.invite.action') })).not.toBeInTheDocument();
  });

  it('validates and sends an invite with roles and country scope', async () => {
    const user = userEvent.setup();
    const { mutations: all } = await renderSignedIn(<AdminsPage />, { ...base, 'POST /admin/admins': () => json(201, { id: 'n1', inviteExpiresAt: '2026-03-01T00:00:00.000Z' }) });
    const mutations = writesOf(all);
    await user.click(await screen.findByRole('button', { name: t('admins.invite.action') }));
    const d = screen.getByRole('dialog', { name: t('admins.invite.title') });
    await user.click(within(d).getByRole('button', { name: t('admins.invite.submit') }));
    expect(mutations()).toHaveLength(0);
    expect(within(d).getByText(t('validation.tooFewItems', { min: 1 }))).toBeInTheDocument();
    await user.type(within(d).getByLabelText(t('admins.invite.email'), { exact: false }), 'new@example.com');
    await user.type(within(d).getByLabelText(t('admins.invite.displayName'), { exact: false }), 'Nia');
    await user.click(within(d).getByLabelText(t('admins.roleNames.support')));
    await user.type(within(d).getByLabelText(t('admins.roles.countryScope')), 'in, us');
    await user.click(within(d).getByRole('button', { name: t('admins.invite.submit') }));
    await waitFor(() => expect(mutations()).toHaveLength(1));
    expect(mutations()[0]).toMatchObject({ method: 'POST', path: '/admin/admins', body: { email: 'new@example.com', displayName: 'Nia', roleKeys: ['support'], countryScope: ['IN', 'US'] } });
    expect(mutations()[0]!.headers['X-CSRF-Token']).toBe('csrf-1');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('rejects malformed country codes client-side', async () => {
    const user = userEvent.setup();
    const { mutations: all } = await renderSignedIn(<AdminsPage />, base);
    const mutations = writesOf(all);
    await user.click(await screen.findByRole('button', { name: t('admins.invite.action') }));
    const d = screen.getByRole('dialog');
    await user.type(within(d).getByLabelText(t('admins.invite.email'), { exact: false }), 'new@example.com');
    await user.type(within(d).getByLabelText(t('admins.invite.displayName'), { exact: false }), 'Nia');
    await user.click(within(d).getByLabelText(t('admins.roleNames.support')));
    await user.type(within(d).getByLabelText(t('admins.roles.countryScope')), 'India');
    await user.click(within(d).getByRole('button', { name: t('admins.invite.submit') }));
    expect(within(d).getByText(t('validation.invalidFormat'))).toBeInTheDocument();
    expect(mutations()).toHaveLength(0);
  });

  it('disables roles the admin cannot grant and explains server escalation errors', async () => {
    const user = userEvent.setup();
    await renderSignedIn(
      <AdminsPage />,
      { ...base, 'POST /admin/admins': () => apiError(403, 'FORBIDDEN', { missing: ['users.view_pii'] }) },
      ['admins.manage', 'users.view'],
    );
    await user.click(await screen.findByRole('button', { name: t('admins.invite.action') }));
    const d = screen.getByRole('dialog');
    expect(within(d).getByLabelText(t('admins.roleNames.super_admin'))).toBeDisabled();
    expect(within(d).getByLabelText(t('admins.roleNames.support'))).toBeDisabled();
    expect(within(d).getByLabelText('People ops')).toBeEnabled();
    await user.type(within(d).getByLabelText(t('admins.invite.email'), { exact: false }), 'new@example.com');
    await user.type(within(d).getByLabelText(t('admins.invite.displayName'), { exact: false }), 'Nia');
    await user.click(within(d).getByLabelText('People ops'));
    await user.click(within(d).getByRole('button', { name: t('admins.invite.submit') }));
    expect(await within(d).findByText(t('admins.roles.escalation', { permissions: t('admins.permissions.users_view_pii') }))).toBeInTheDocument();
  });

  it('updates roles and country scope of an admin', async () => {
    const user = userEvent.setup();
    const { mutations: all } = await renderSignedIn(<AdminsPage />, { ...base, 'PUT /admin/admins/c1/roles': () => json(200, {}) });
    const mutations = writesOf(all);
    await user.click(await screen.findByRole('button', { name: `${t('admins.editRoles.action')} carol@example.com` }));
    const d = screen.getByRole('dialog');
    expect(within(d).getByText(t('admins.editRoles.sessionsNote'))).toBeInTheDocument();
    expect(within(d).getByLabelText(t('admins.roleNames.support'))).toBeChecked();
    expect(within(d).getByLabelText(t('admins.roles.countryScope'))).toHaveValue('IN, US');
    await user.click(within(d).getByLabelText('People ops'));
    const scope = within(d).getByLabelText(t('admins.roles.countryScope'));
    await user.clear(scope);
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    await waitFor(() => expect(mutations()).toHaveLength(1));
    expect(mutations()[0]).toMatchObject({ method: 'PUT', path: '/admin/admins/c1/roles', body: { roleKeys: ['support', 'people_ops'], countryScope: null } });
  });

  it('warns when editing your own roles', async () => {
    const user = userEvent.setup();
    await renderSignedIn(<AdminsPage />, base);
    await user.click(await screen.findByRole('button', { name: `${t('admins.editRoles.action')} admin@example.com` }));
    expect(within(screen.getByRole('dialog')).getByText(t('admins.editRoles.selfNote'))).toBeInTheDocument();
  });

  it('disables an admin after confirmation and surfaces API conflicts', async () => {
    const user = userEvent.setup();
    let conflict = false;
    const { mutations: all } = await renderSignedIn(<AdminsPage />, { ...base, 'POST /admin/admins/c1/disable': () => (conflict ? apiError(409, 'CONFLICT') : json(204)) });
    const mutations = writesOf(all);
    await user.click(await screen.findByRole('button', { name: `${t('admins.ops.disable')} carol@example.com` }));
    const d = screen.getByRole('dialog', { name: t('admins.ops.disableTitle', { email: 'carol@example.com' }) });
    await user.click(within(d).getByRole('button', { name: t('admins.ops.disable') }));
    await waitFor(() => expect(mutations()).toHaveLength(1));
    expect(mutations()[0]).toMatchObject({ method: 'POST', path: '/admin/admins/c1/disable' });
    expect(await screen.findByText(t('admins.ops.disabledDone', { email: 'carol@example.com' }))).toBeInTheDocument();

    conflict = true;
    await user.click(await screen.findByRole('button', { name: `${t('admins.ops.disable')} carol@example.com` }));
    const d2 = screen.getByRole('dialog');
    await user.click(within(d2).getByRole('button', { name: t('admins.ops.disable') }));
    expect(await within(d2).findByText(t('errors.CONFLICT'))).toBeInTheDocument();
  });

  it('enables a disabled admin', async () => {
    const user = userEvent.setup();
    const { mutations: all } = await renderSignedIn(<AdminsPage />, { ...base, 'POST /admin/admins/b1/enable': () => json(204) });
    const mutations = writesOf(all);
    await user.click(await screen.findByRole('button', { name: `${t('admins.ops.enable')} bob@example.com` }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: t('admins.ops.enable') }));
    await waitFor(() => expect(mutations()).toHaveLength(1));
    expect(mutations()[0]!.path).toBe('/admin/admins/b1/enable');
  });

  it('requires typing the email to reset MFA', async () => {
    const user = userEvent.setup();
    const { mutations: all } = await renderSignedIn(<AdminsPage />, { ...base, 'POST /admin/admins/c1/reset-mfa': () => json(204) });
    const mutations = writesOf(all);
    await user.click(await screen.findByRole('button', { name: `${t('admins.ops.resetMfa')} carol@example.com` }));
    const d = screen.getByRole('dialog');
    await user.click(within(d).getByRole('button', { name: t('admins.ops.resetMfa') }));
    expect(within(d).getByText(t('confirmText.mismatch'))).toBeInTheDocument();
    expect(mutations()).toHaveLength(0);
    await user.type(field(t('confirmText.label', { phrase: 'carol@example.com' })), 'carol@example.com');
    await user.click(within(d).getByRole('button', { name: t('admins.ops.resetMfa') }));
    await waitFor(() => expect(mutations()).toHaveLength(1));
    expect(mutations()[0]!.path).toBe('/admin/admins/c1/reset-mfa');
  });

  it('warns that resetting your own MFA signs you out', async () => {
    const user = userEvent.setup();
    await renderSignedIn(<AdminsPage />, base);
    await user.click(await screen.findByRole('button', { name: `${t('admins.ops.resetMfa')} admin@example.com` }));
    expect(within(screen.getByRole('dialog')).getByText(t('admins.ops.resetMfaSelf'))).toBeInTheDocument();
  });
});
