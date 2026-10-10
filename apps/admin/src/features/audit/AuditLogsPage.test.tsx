import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { t } from '@/i18n';
import { apiError, field, renderSignedIn } from '@/test/utils';
import { AuditLogsPage } from './AuditLogsPage';

const entry = (id: string, action = 'flags.upserted') => ({
  id, actorType: 'admin', actorId: '7b1f0f5e-2a40-4a8e-9d1c-1f2a3b4c5d6e', action, targetType: 'feature_flag', targetId: 'travel_mode',
  before: { enabled: false, rules: [] }, after: { enabled: true, rules: [] }, reason: null, ip: '127.0.0.1', requestId: 'rq', createdAt: '2026-10-01T10:00:00.000Z',
});

describe('AuditLogsPage', () => {
  it('lists entries, paginates with the cursor and shows a before/after diff', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<AuditLogsPage />, {
      'GET /admin/audit-logs': (c) => (c.query.get('cursor') === 'c2' ? { items: [entry('1', 'cms.archived')], nextCursor: null } : { items: [entry('2')], nextCursor: 'c2' }),
    });
    expect(await screen.findByText('flags.upserted')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('common.loadMore') }));
    expect(await screen.findByText('cms.archived')).toBeInTheDocument();
    expect(screen.getByText(t('common.endOfList'))).toBeInTheDocument();
    expect(calls.filter((c) => c.path === '/admin/audit-logs').map((c) => c.query.get('cursor'))).toEqual([null, 'c2']);

    await user.click(screen.getAllByRole('button', { name: t('audit.viewChanges') })[0]!);
    const row = screen.getByRole('rowheader', { name: 'enabled' }).closest('tr')!;
    expect(within(row).getByText(t('diff.changed'))).toBeInTheDocument();
    expect(within(row).getByText('false')).toBeInTheDocument();
    expect(within(row).getByText('true')).toBeInTheDocument();
  });

  it('validates filters with the API schema and sends them as query params', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<AuditLogsPage />, { 'GET /admin/audit-logs': () => ({ items: [], nextCursor: null }) });
    expect(await screen.findByText(t('audit.empty'))).toBeInTheDocument();
    await user.type(field(t('audit.actorId')), 'not-a-uuid');
    await user.click(screen.getByRole('button', { name: t('common.apply') }));
    expect(screen.getByText(t('validation.invalidUuid'))).toBeInTheDocument();
    await user.clear(field(t('audit.actorId')));
    await user.selectOptions(field(t('audit.actorType')), 'admin');
    await user.type(screen.getByLabelText(t('audit.action')), 'legal.published');
    await user.click(screen.getByRole('button', { name: t('common.apply') }));
    const last = calls.filter((c) => c.path === '/admin/audit-logs').at(-1)!;
    expect(Object.fromEntries(last.query)).toEqual({ actorType: 'admin', action: 'legal.published', limit: '50' });
  });

  it('shows an error state with retry', async () => {
    let fail = true;
    const user = userEvent.setup();
    await renderSignedIn(<AuditLogsPage />, { 'GET /admin/audit-logs': () => (fail ? apiError(500, 'INTERNAL') : { items: [], nextCursor: null }) });
    expect(await screen.findByText(t('errors.INTERNAL'))).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: t('common.retry') }));
    expect(await screen.findByText(t('audit.empty'))).toBeInTheDocument();
  });
});
