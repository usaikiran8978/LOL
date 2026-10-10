import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { t } from '@/i18n';
import { apiError, field, renderSignedIn, type RecordedCall } from '@/test/utils';
import { navigationState } from '@/test/setup';
import { PrivacyHome, RetentionRoute } from './PrivacyHome';
import { urgency } from './labels';

const UID = '3f1c2b4a-1111-4a8e-9d1c-1f2a3b4c5d6e';
const day = 86_400_000;
const iso = (offset: number) => new Date(Date.now() + offset).toISOString();

const req = (id: string, kind: string, dueOffset: number, extra: Record<string, unknown> = {}) => ({
  id, user_id: UID, subject_email: 'ada@example.com', kind, status: 'verifying', regime: 'GDPR', due_at: iso(dueOffset),
  created_at: iso(-20 * day), completed_at: null, handled_by: null, notes: null, ...extra,
});

const page = <T,>(items: T[], nextCursor: string | null = null) => ({ items, nextCursor });

const nonAuth = (calls: RecordedCall[]) => calls.filter((c) => c.method !== 'GET' && !c.path.startsWith('/admin/auth'));

describe('urgency', () => {
  it('flags open requests past or near their due date only', () => {
    const now = Date.parse('2026-10-08T00:00:00Z');
    expect(urgency({ status: 'received', due_at: '2026-10-07T00:00:00Z' }, now)).toBe('overdue');
    expect(urgency({ status: 'in_progress', due_at: '2026-10-10T00:00:00Z' }, now)).toBe('dueSoon');
    expect(urgency({ status: 'verifying', due_at: '2026-11-10T00:00:00Z' }, now)).toBeNull();
    expect(urgency({ status: 'completed', due_at: '2026-10-01T00:00:00Z' }, now)).toBeNull();
  });
});

describe('Privacy requests', () => {
  it('lists the queue by due date with overdue / due-soon rows marked by class and text', async () => {
    navigationState.pathname = '/privacy';
    await renderSignedIn(<PrivacyHome />, {
      'GET /admin/privacy/requests': () => page([req('r1', 'delete', -2 * day), req('r2', 'export', 3 * day), req('r3', 'rectify', 25 * day)]),
    });
    const overdue = (await screen.findByText(t('privacy.requests.overdue'))).closest('tr')!;
    expect(overdue).toHaveClass('is-danger');
    expect(within(overdue).getByText(t('privacy.requests.kinds.delete'))).toBeInTheDocument();
    const soon = screen.getByText(t('privacy.requests.dueSoon')).closest('tr')!;
    expect(soon).toHaveClass('is-warning');
    const normal = screen.getByText(t('privacy.requests.kinds.rectify')).closest('tr')!;
    expect(normal.className).toBe('');
    expect(screen.getAllByText('ada@example.com')).toHaveLength(3);
    // Both privacy permissions → tabs between the two sections.
    expect(screen.getByRole('link', { name: t('privacy.tabs.retention') })).toHaveAttribute('href', '/privacy/retention');
  });

  it('loads further pages with the cursor', async () => {
    navigationState.pathname = '/privacy';
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<PrivacyHome />, {
      'GET /admin/privacy/requests': (c) => (c.query.get('cursor') ? page([req('r2', 'rectify', 20 * day)]) : page([req('r1', 'export', 10 * day)], 'cur-2')),
    });
    expect(await screen.findByText(t('privacy.requests.kinds.export'))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('common.loadMore') }));
    expect(await screen.findByText(t('privacy.requests.kinds.rectify'))).toBeInTheDocument();
    expect(calls.filter((c) => c.path === '/admin/privacy/requests').at(-1)!.query.get('cursor')).toBe('cur-2');
  });

  it('hides the subject email without users.view_pii and filters by status', async () => {
    navigationState.pathname = '/privacy';
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<PrivacyHome />, { 'GET /admin/privacy/requests': () => page([req('r1', 'export', 10 * day)]) }, ['privacy.requests']);
    expect(await screen.findByText(t('privacy.requests.kinds.export'))).toBeInTheDocument();
    expect(screen.queryByText('ada@example.com')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: t('privacy.tabs.retention') })).not.toBeInTheDocument();
    await user.selectOptions(field(t('privacy.requests.filter')), 'completed');
    await waitFor(() => expect(calls.filter((c) => c.path === '/admin/privacy/requests').at(-1)!.query.get('status')).toBe('completed'));
  });

  it('requires typing the user id before executing a deletion', async () => {
    navigationState.pathname = '/privacy';
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<PrivacyHome />, {
      'GET /admin/privacy/requests': () => page([req('9b1f0f5e-2a40-4a8e-9d1c-1f2a3b4c5d6e', 'delete', 5 * day)]),
      'POST /admin/privacy/requests/9b1f0f5e-2a40-4a8e-9d1c-1f2a3b4c5d6e/execute': () => new Response(null, { status: 204 }),
    });
    await user.click(await screen.findByRole('button', { name: `${t('privacy.requests.execute')} ${t('privacy.requests.kinds.delete')} ${UID}` }));
    const dialog = screen.getByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: t('privacy.execute.confirmDelete') });
    await user.click(confirm);
    expect(within(dialog).getByText(t('confirmText.mismatch'))).toBeInTheDocument();
    expect(nonAuth(calls)).toHaveLength(0);
    await user.type(within(dialog).getByLabelText(t('confirmText.label', { phrase: UID }), { exact: false }), UID);
    await user.click(confirm);
    await waitFor(() => expect(nonAuth(calls)).toHaveLength(1));
    expect(nonAuth(calls)[0]!.path).toBe('/admin/privacy/requests/9b1f0f5e-2a40-4a8e-9d1c-1f2a3b4c5d6e/execute');
    expect(await screen.findByText(t('privacy.execute.done'))).toBeInTheDocument();
  });

  it('does not offer execution for requests that are already in progress', async () => {
    navigationState.pathname = '/privacy';
    await renderSignedIn(<PrivacyHome />, { 'GET /admin/privacy/requests': () => page([req('r1', 'export', 5 * day, { status: 'in_progress' })]) });
    expect(await screen.findByRole('cell', { name: t('privacy.requests.statuses.in_progress') })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: new RegExp(t('privacy.requests.execute')) })).not.toBeInTheDocument();
  });

  it('logs a request on behalf of a user with client-side validation', async () => {
    navigationState.pathname = '/privacy';
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<PrivacyHome />, {
      'GET /admin/privacy/requests': () => page([]),
      'POST /admin/privacy/requests': () => ({ id: 'new' }),
    });
    expect(await screen.findByText(t('privacy.requests.empty'))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('privacy.requests.newRequest') }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(t('privacy.create.userId'), { exact: false }), 'nope');
    await user.click(within(dialog).getByRole('button', { name: t('privacy.create.submit') }));
    expect(within(dialog).getByText(t('validation.invalidUuid'))).toBeInTheDocument();
    await user.clear(within(dialog).getByLabelText(t('privacy.create.userId'), { exact: false }));
    await user.type(within(dialog).getByLabelText(t('privacy.create.userId'), { exact: false }), UID);
    await user.selectOptions(within(dialog).getByLabelText(t('privacy.create.kind'), { exact: false }), 'delete');
    await user.type(within(dialog).getByLabelText(t('privacy.create.notes')), 'Emailed request');
    await user.click(within(dialog).getByRole('button', { name: t('privacy.create.submit') }));
    await waitFor(() => expect(nonAuth(calls)).toHaveLength(1));
    expect(nonAuth(calls)[0]!.body).toEqual({ userId: UID, kind: 'delete', notes: 'Emailed request' });
    expect(await screen.findByText(t('privacy.create.done'))).toBeInTheDocument();
  });

  it('shows an error state with retry', async () => {
    navigationState.pathname = '/privacy';
    let fail = true;
    const user = userEvent.setup();
    await renderSignedIn(<PrivacyHome />, { 'GET /admin/privacy/requests': () => (fail ? apiError(500, 'INTERNAL') : page([])) });
    expect(await screen.findByText(t('errors.INTERNAL'))).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: t('common.retry') }));
    expect(await screen.findByText(t('privacy.requests.empty'))).toBeInTheDocument();
  });
});

const policy = { entity: 'messages', retention_days: 730, action: 'delete', country_overrides: { DE: 365 }, updated_by: null, updated_at: '2026-10-01T10:00:00.000Z' };

describe('Retention policies', () => {
  it('lands on retention when the admin can only manage retention', async () => {
    navigationState.pathname = '/privacy';
    const { calls } = await renderSignedIn(<PrivacyHome />, { 'GET /admin/privacy/retention': () => [policy] }, ['privacy.retention.manage']);
    expect(await screen.findByText(t('privacy.retention.entities.messages'))).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/admin/privacy/requests')).toBe(false);
  });

  it('is forbidden without privacy.retention.manage', async () => {
    navigationState.pathname = '/privacy/retention';
    await renderSignedIn(<RetentionRoute />, {}, ['privacy.requests']);
    expect(screen.getByText(t('states.forbiddenTitle'))).toBeInTheDocument();
  });

  it('edits a policy after validation and an explicit confirmation', async () => {
    navigationState.pathname = '/privacy/retention';
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<RetentionRoute />, {
      'GET /admin/privacy/retention': () => [policy],
      'PUT /admin/privacy/retention/messages': () => json200(),
    });
    expect(await screen.findByText('DE: 365')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: `${t('privacy.retention.edit')} ${t('privacy.retention.entities.messages')}` }));
    let dialog = screen.getByRole('dialog');
    const days = within(dialog).getByLabelText(t('privacy.retention.retentionDays'), { exact: false });
    await user.clear(days);
    await user.type(days, '0');
    await user.click(within(dialog).getByRole('button', { name: t('common.save') }));
    expect(within(dialog).getByText(t('validation.tooSmall', { min: 1 }))).toBeInTheDocument();
    await user.clear(days);
    await user.type(days, '365');
    await user.selectOptions(within(dialog).getByLabelText(t('privacy.retention.action'), { exact: false }), 'anonymize');
    await user.click(within(dialog).getByRole('button', { name: t('common.save') }));
    dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: t('privacy.retention.confirmTitle') })).toBeInTheDocument();
    expect(nonAuth(calls)).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: t('privacy.retention.confirm') }));
    await waitFor(() => expect(nonAuth(calls)).toHaveLength(1));
    expect(nonAuth(calls)[0]!.body).toEqual({ retentionDays: 365, action: 'anonymize' });
    expect(await screen.findByText(t('privacy.retention.done'))).toBeInTheDocument();
  });

  it('shows an error state with retry and an empty state', async () => {
    navigationState.pathname = '/privacy/retention';
    let fail = true;
    const user = userEvent.setup();
    await renderSignedIn(<RetentionRoute />, { 'GET /admin/privacy/retention': () => (fail ? apiError(500, 'INTERNAL') : []) });
    expect(await screen.findByText(t('errors.INTERNAL'))).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: t('common.retry') }));
    expect(await screen.findByText(t('privacy.retention.empty'))).toBeInTheDocument();
  });
});

function json200() {
  return new Response(null, { status: 200 });
}
