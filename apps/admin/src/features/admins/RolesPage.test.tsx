import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { t } from '@/i18n';
import { apiError, field, json, renderSignedIn } from '@/test/utils';
import { RolesPage } from './RolesPage';
import { adminRows, roleRows, writesOf } from './testFixtures';

const base = {
  'GET /admin/roles': () => roleRows,
  'GET /admin/admins': () => adminRows,
};

const rowOf = (key: string) => screen.getByText(key, { selector: 'code' }).closest('tr')!;

describe('RolesPage', () => {
  it('lists system roles read-only and custom roles with edit / delete', async () => {
    const user = userEvent.setup();
    await renderSignedIn(<RolesPage />, base);
    await screen.findByText('super_admin', { selector: 'code' });
    const sa = rowOf('super_admin');
    expect(within(sa).getByText(t('admins.rolesPage.system'))).toBeInTheDocument();
    expect(within(sa).getByText(t('admins.rolesPage.assignedCount', { count: 1 }))).toBeInTheDocument();
    expect(within(sa).queryByRole('button', { name: `${t('common.edit')} super_admin` })).not.toBeInTheDocument();
    expect(within(sa).queryByRole('button', { name: `${t('admins.rolesPage.delete')} super_admin` })).not.toBeInTheDocument();
    // Custom role still assigned → cannot be deleted.
    expect(within(rowOf('people_ops')).getByRole('button', { name: `${t('admins.rolesPage.delete')} people_ops` })).toBeDisabled();
    expect(within(rowOf('unused_role')).getByRole('button', { name: `${t('admins.rolesPage.delete')} unused_role` })).toBeEnabled();

    await user.click(within(sa).getByRole('button', { name: `${t('common.view')} super_admin` }));
    const d = screen.getByRole('dialog');
    expect(within(d).getByText(t('admins.rolesPage.systemReadOnly'))).toBeInTheDocument();
    expect(within(d).getByLabelText(t('admins.permissions.audit_view'))).toBeChecked();
    expect(within(d).getByLabelText(t('admins.permissions.audit_view'))).toBeDisabled();
    expect(within(d).getByRole('group', { name: t('admins.domains.billing') })).toBeInTheDocument();
  });

  it('shows the empty state', async () => {
    await renderSignedIn(<RolesPage />, { ...base, 'GET /admin/roles': () => [] });
    expect(await screen.findByText(t('admins.rolesPage.empty'))).toBeInTheDocument();
  });

  it('shows the error state and retries', async () => {
    let fail = true;
    const user = userEvent.setup();
    await renderSignedIn(<RolesPage />, { ...base, 'GET /admin/roles': () => (fail ? apiError(503, 'INTERNAL') : roleRows) });
    expect(await screen.findByText(t('errors.INTERNAL'))).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: t('common.retry') }));
    expect(await screen.findByText('people_ops', { selector: 'code' })).toBeInTheDocument();
  });

  it('is forbidden without admins.manage', async () => {
    const { calls } = await renderSignedIn(<RolesPage />, base, ['audit.view']);
    expect(screen.getByText(t('states.forbiddenTitle'))).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/admin/roles')).toBe(false);
  });

  it('creates a custom role from the grouped permission checklist', async () => {
    const user = userEvent.setup();
    const { mutations: all } = await renderSignedIn(<RolesPage />, { ...base, 'PUT /admin/roles/moderation_lead': (c) => json(200, { key: 'moderation_lead', permissions: (c.body as { permissions: string[] }).permissions }) });
    const mutations = writesOf(all);
    await user.click(await screen.findByRole('button', { name: t('admins.rolesPage.newRole') }));
    const d = screen.getByRole('dialog');
    const key = within(d).getByLabelText(t('admins.rolesPage.key'), { exact: false });
    await user.type(key, 'people_ops');
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    expect(within(d).getByText(t('admins.rolesPage.keyTaken'))).toBeInTheDocument();
    await user.clear(key);
    await user.type(key, 'support');
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    expect(within(d).getByText(t('admins.rolesPage.keyReserved'))).toBeInTheDocument();
    await user.clear(key);
    await user.type(key, 'Bad Key');
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    expect(within(d).getByText(t('validation.invalidFormat'))).toBeInTheDocument();
    expect(mutations()).toHaveLength(0);

    await user.clear(key);
    await user.type(key, 'moderation_lead');
    await user.type(within(d).getByLabelText(t('admins.rolesPage.name'), { exact: false }), 'Moderation lead');
    await user.click(within(d).getByRole('button', { name: `${t('admins.rolesPage.selectAll')}: ${t('admins.domains.moderation')}` }));
    await user.click(within(d).getByLabelText(t('admins.permissions.moderation_ban')));
    await user.click(within(d).getByLabelText(t('admins.permissions.audit_view')));
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    await waitFor(() => expect(mutations()).toHaveLength(1));
    expect(mutations()[0]).toMatchObject({
      method: 'PUT',
      path: '/admin/roles/moderation_lead',
      body: {
        name: 'Moderation lead',
        permissions: ['audit.view', 'moderation.action', 'moderation.appeals', 'moderation.assign', 'moderation.escalate', 'moderation.rules.manage', 'moderation.view', 'moderation.view_messages'],
      },
    });
    expect(await screen.findByText(t('admins.rolesPage.saved', { key: 'moderation_lead' }))).toBeInTheDocument();
  }, 20_000); // many user-event interactions; slow under parallel CI load

  it('edits a custom role; permissions the editor lacks cannot be added', async () => {
    const user = userEvent.setup();
    const { mutations: all } = await renderSignedIn(<RolesPage />, { ...base, 'PUT /admin/roles/people_ops': () => json(200, {}) }, ['admins.manage', 'users.view', 'users.export']);
    const mutations = writesOf(all);
    await user.click(await screen.findByRole('button', { name: `${t('common.edit')} people_ops` }));
    const d = screen.getByRole('dialog');
    expect(within(d).getByLabelText(t('admins.rolesPage.key'))).toHaveAttribute('readonly');
    expect(within(d).getByLabelText(t('admins.permissions.billing_refund'))).toBeDisabled();
    await user.click(within(d).getByLabelText(t('admins.permissions.users_export')));
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    await waitFor(() => expect(mutations()).toHaveLength(1));
    expect(mutations()[0]!.body).toEqual({ name: 'People ops', permissions: ['admins.manage', 'users.export', 'users.view'] });
  });

  it('deletes an unassigned custom role after typing its key', async () => {
    const user = userEvent.setup();
    const { mutations: all } = await renderSignedIn(<RolesPage />, { ...base, 'DELETE /admin/roles/unused_role': () => json(204) });
    const mutations = writesOf(all);
    await user.click(await screen.findByRole('button', { name: `${t('admins.rolesPage.delete')} unused_role` }));
    const d = screen.getByRole('dialog', { name: t('admins.rolesPage.deleteTitle', { key: 'unused_role' }) });
    await user.type(field(t('confirmText.label', { phrase: 'unused_role' })), 'unused_role');
    await user.click(within(d).getByRole('button', { name: t('admins.rolesPage.delete') }));
    await waitFor(() => expect(mutations()).toHaveLength(1));
    expect(mutations()[0]).toMatchObject({ method: 'DELETE', path: '/admin/roles/unused_role' });
    expect(await screen.findByText(t('admins.rolesPage.deleted', { key: 'unused_role' }))).toBeInTheDocument();
  });
});
