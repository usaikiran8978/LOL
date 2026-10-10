import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { t } from '@/i18n';
import { navigationState, routerMock } from '@/test/setup';
import { apiError, field, renderSignedIn } from '@/test/utils';
import { CasesPage } from './CasesPage';
import { CASE_ID, caseRow, USER_ID, without, writes } from './fixtures';
import { ModerationIndex } from './ModerationTabs';

beforeEach(() => {
  navigationState.pathname = '/moderation/cases';
  routerMock.push.mockClear();
  routerMock.replace.mockClear();
});

describe('CasesPage', () => {
  it('lists the queue with severity, SLA breach and reports, and links to the case', async () => {
    const { calls } = await renderSignedIn(<CasesPage />, {
      'GET /admin/moderation/cases': () => ({ items: [caseRow(), caseRow({ id: 'c2', display_name: 'Kim', severity: 'critical', sla_breached: true, assigned_to: 'a1' })], nextCursor: null }),
    });
    expect(screen.getByText(t('app.loading'))).toBeInTheDocument();
    expect(await screen.findByText('Sam')).toBeInTheDocument();
    const rows = screen.getAllByRole('row');
    expect(within(rows[2]!).getByText(t('safety.cases.slaBreached'))).toBeInTheDocument();
    expect(within(rows[2]!).getByText(t('safety.severity.critical'))).toBeInTheDocument();
    expect(within(rows[2]!).getByText(t('safety.cases.you'))).toBeInTheDocument();
    expect(rows[2]).toHaveClass('is-danger');
    expect(within(rows[1]!).getByText(t('safety.cases.unassigned'))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: `${t('safety.cases.open')} Sam` })).toHaveAttribute('href', `/moderation/cases/${CASE_ID}`);
    expect(calls.find((c) => c.path === '/admin/moderation/cases')!.query.get('limit')).toBe('25');
    expect(screen.getByText(t('common.endOfList'))).toBeInTheDocument();
  });

  it('applies validated filters as query parameters and pages with the cursor', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<CasesPage />, {
      'GET /admin/moderation/cases': (c) => (c.query.get('cursor') ? { items: [caseRow({ id: 'c3', display_name: 'Lee' })], nextCursor: null } : { items: [caseRow()], nextCursor: 'cur-1' }),
    });
    await user.click(await screen.findByRole('button', { name: t('common.loadMore') }));
    expect(await screen.findByText('Lee')).toBeInTheDocument();
    expect(calls.at(-1)!.query.get('cursor')).toBe('cur-1');

    await user.selectOptions(field(t('safety.cases.severity')), 'critical');
    await user.selectOptions(field(t('safety.cases.assignedTo')), 'unassigned');
    await user.type(field(t('safety.cases.subjectUserId')), 'not-a-uuid');
    await user.click(screen.getByRole('button', { name: t('common.apply') }));
    expect(screen.getByText(t('validation.invalidUuid'))).toBeInTheDocument();
    await user.clear(field(t('safety.cases.subjectUserId')));
    await user.type(field(t('safety.cases.subjectUserId')), USER_ID);
    await user.click(screen.getByRole('button', { name: t('common.apply') }));
    await waitFor(() => expect(calls.at(-1)!.query.get('severity')).toBe('critical'));
    const q = calls.at(-1)!.query;
    expect(q.get('assignedTo')).toBe('unassigned');
    expect(q.get('subjectUserId')).toBe(USER_ID);
    expect(q.get('cursor')).toBeNull();
  });

  it('shows the empty state and the error state with retry', async () => {
    let fail = true;
    const user = userEvent.setup();
    await renderSignedIn(<CasesPage />, { 'GET /admin/moderation/cases': () => (fail ? apiError(500, 'INTERNAL') : { items: [], nextCursor: null }) });
    expect(await screen.findByText(t('errors.INTERNAL'))).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: t('common.retry') }));
    expect(await screen.findByText(t('safety.cases.empty'))).toBeInTheDocument();
  });

  it('hides case creation without moderation.action and forbids the page without moderation.view', async () => {
    const first = await renderSignedIn(<CasesPage />, { 'GET /admin/moderation/cases': () => ({ items: [], nextCursor: null }) }, without('moderation.action'));
    expect(await screen.findByText(t('safety.cases.empty'))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('safety.create.open') })).not.toBeInTheDocument();
    first.unmount();
    const { calls } = await renderSignedIn(<CasesPage />, {}, without('moderation.view'));
    expect(screen.getByText(t('states.forbiddenTitle'))).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/admin/moderation/cases')).toBe(false);
  });

  it('opens a case manually and navigates to it', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<CasesPage />, {
      'GET /admin/moderation/cases': () => ({ items: [], nextCursor: null }),
      'POST /admin/moderation/cases': () => ({ caseId: CASE_ID }),
    });
    await user.click(await screen.findByRole('button', { name: t('safety.create.open') }));
    const d = screen.getByRole('dialog');
    await user.click(within(d).getByRole('button', { name: t('safety.create.submit') }));
    expect(within(d).getAllByRole('alert').length).toBeGreaterThan(0);
    expect(writes(calls)).toHaveLength(0);
    await user.type(within(d).getByLabelText(t('safety.create.subjectUserId'), { exact: false }), USER_ID);
    await user.selectOptions(within(d).getByLabelText(t('safety.create.category'), { exact: false }), 'harassment');
    await user.selectOptions(within(d).getByLabelText(t('safety.create.severity'), { exact: false }), 'critical');
    await user.type(within(d).getByLabelText(t('safety.create.note')), 'Escalated by support');
    await user.click(within(d).getByRole('button', { name: t('safety.create.submit') }));
    await waitFor(() => expect(routerMock.push).toHaveBeenCalledWith(`/moderation/cases/${CASE_ID}`));
    expect(writes(calls)[0]!.body).toEqual({ subjectUserId: USER_ID, category: 'harassment', severity: 'critical', note: 'Escalated by support' });
  });
});

describe('ModerationIndex', () => {
  it('forwards to the first sub-page the admin may open', async () => {
    await renderSignedIn(<ModerationIndex />, {}, ['profiles.review']);
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/moderation/profile-review'));
  });

  it('shows forbidden when no moderation permission is held', async () => {
    await renderSignedIn(<ModerationIndex />, {}, ['users.view']);
    expect(screen.getByText(t('states.forbiddenTitle'))).toBeInTheDocument();
  });
});
