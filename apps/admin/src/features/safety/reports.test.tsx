import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { t } from '@/i18n';
import { navigationState } from '@/test/setup';
import { apiError, renderSignedIn } from '@/test/utils';
import { CASE_ID, USER_ID, without } from './fixtures';
import { ReportsPage } from './ReportsPage';
import { RiskScoresPage } from './RiskScoresPage';

const REPORTER = '99999999-9999-4999-8999-999999999999';
const report = (over: Record<string, unknown> = {}) => ({
  id: 'r1', reporter_id: REPORTER, reported_user_id: USER_ID, target_type: 'message', target_id: 'msg-1', reason_key: 'scam', details: 'Asked me for money',
  case_id: CASE_ID, status: 'received', created_at: '2026-10-08T08:00:00Z', country_code: 'DE', ...over,
});
const page = (items: unknown[], nextCursor: string | null = null) => ({ items, nextCursor });

describe('ReportsPage', () => {
  beforeEach(() => {
    navigationState.pathname = '/moderation/reports';
  });

  it('lists reports with links to the case and the reported user, and filters', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<ReportsPage />, {
      'GET /admin/moderation/reports': (c) => (c.query.get('status') === 'dismissed' ? page([]) : page([report()])),
    });
    expect(await screen.findByText('Asked me for money')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: `${t('safety.reports.openCase')} ${CASE_ID}` })).toHaveAttribute('href', `/moderation/cases/${CASE_ID}`);
    const row = screen.getByText('Asked me for money').closest('tr')!;
    expect(within(row).getByRole('link', { name: USER_ID })).toHaveAttribute('href', `/users/${USER_ID}`);
    expect(within(row).getByRole('link', { name: REPORTER })).toBeInTheDocument();
    // Moderation tabs include the new sections.
    expect(screen.getByRole('link', { name: t('safety.tabs.reports') })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: t('safety.tabs.riskScores') })).toBeInTheDocument();

    await user.type(screen.getByLabelText(t('safety.reports.reportedUserId')), 'nope');
    await user.click(screen.getByRole('button', { name: t('common.apply') }));
    expect(screen.getByText(t('validation.invalidUuid'))).toBeInTheDocument();
    await user.clear(screen.getByLabelText(t('safety.reports.reportedUserId')));
    await user.type(screen.getByLabelText(t('safety.reports.reportedUserId')), USER_ID);
    await user.type(screen.getByLabelText(t('safety.reports.reasonKey')), 'scam');
    await user.selectOptions(screen.getByLabelText(t('safety.reports.status')), 'dismissed');
    await user.click(screen.getByRole('button', { name: t('common.apply') }));
    expect(await screen.findByText(t('safety.reports.empty'))).toBeInTheDocument();
    const q = calls.filter((c) => c.path === '/admin/moderation/reports').at(-1)!.query;
    expect([q.get('status'), q.get('reasonKey'), q.get('reportedUserId')]).toEqual(['dismissed', 'scam', USER_ID]);
  });

  it('hides the reporter without users.view_pii, shows reports without a case and pages', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<ReportsPage />, {
      'GET /admin/moderation/reports': (c) => (c.query.get('cursor') === 'p2' ? page([report({ id: 'r2', details: 'Second page', case_id: null, reporter_id: null })]) : page([report({ reporter_id: null })], 'p2')),
    }, without('users.view_pii'));
    expect(await screen.findByText(t('safety.reports.reporterHiddenHint'))).toBeInTheDocument();
    expect(await screen.findAllByText(t('safety.reports.reporterHidden'))).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: t('common.loadMore') }));
    expect(await screen.findByText('Second page')).toBeInTheDocument();
    expect(screen.getByText(t('safety.reports.noCase'))).toBeInTheDocument();
    expect(calls.filter((c) => c.path === '/admin/moderation/reports').at(-1)!.query.get('cursor')).toBe('p2');
  });

  it('shows error/retry, empty state and gating', async () => {
    const user = userEvent.setup();
    let fail = true;
    const first = await renderSignedIn(<ReportsPage />, { 'GET /admin/moderation/reports': () => (fail ? apiError(500, 'INTERNAL') : page([])) });
    expect(await screen.findByText(t('errors.INTERNAL'))).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: t('common.retry') }));
    expect(await screen.findByText(t('safety.reports.empty'))).toBeInTheDocument();
    first.unmount();
    const { calls } = await renderSignedIn(<ReportsPage />, {}, without('moderation.view'));
    expect(screen.getByText(t('states.forbiddenTitle'))).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/admin/moderation/reports')).toBe(false);
  });
});

describe('RiskScoresPage', () => {
  beforeEach(() => {
    navigationState.pathname = '/moderation/risk-scores';
  });

  const score = (over: Record<string, unknown> = {}) => ({
    user_id: USER_ID, display_name: 'Sam', status: 'active', country_code: 'DE', score: '0.8700', components: { signals: { scam: 2 }, reporters: 3 }, computed_at: '2026-10-08T08:00:00Z', ...over,
  });

  it('lists users by score with their components and a link to the user', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<RiskScoresPage />, { 'GET /admin/moderation/risk-scores': (c) => (c.query.get('minScore') === '0.9' ? page([]) : page([score()])) });
    const row = (await screen.findByText('Sam')).closest('tr')!;
    expect(row).toHaveClass('is-danger');
    expect(within(row).getByText('87%')).toBeInTheDocument();
    expect(within(row).getByText('3')).toBeInTheDocument();
    expect(within(row).getByText(`${t('safety.signal.scam')} × 2`)).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: `${t('safety.riskScores.openUser')} Sam` })).toHaveAttribute('href', `/users/${USER_ID}`);
    expect(calls.find((c) => c.path === '/admin/moderation/risk-scores')!.query.get('minScore')).toBe('0.5');

    const min = screen.getByLabelText(t('safety.riskScores.minScore'));
    await user.clear(min);
    await user.type(min, '2');
    await user.click(screen.getByRole('button', { name: t('common.apply') }));
    expect(screen.getByText(t('validation.tooBig', { max: 1 }))).toBeInTheDocument();
    await user.clear(min);
    await user.type(min, '0.9');
    await user.click(screen.getByRole('button', { name: t('common.apply') }));
    expect(await screen.findByText(t('safety.riskScores.empty'))).toBeInTheDocument();
  });

  it('pages, shows errors with retry and is gated by moderation.view', async () => {
    const user = userEvent.setup();
    let fail = true;
    const first = await renderSignedIn(<RiskScoresPage />, {
      'GET /admin/moderation/risk-scores': (c) => (fail ? apiError(500, 'INTERNAL') : c.query.get('cursor') ? page([score({ user_id: 'u2', display_name: 'Kim', score: 0.6, components: null })]) : page([score()], 'c2')),
    }, without('users.view'));
    expect(await screen.findByText(t('errors.INTERNAL'))).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: t('common.retry') }));
    expect(await screen.findByText('Sam')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: new RegExp(t('safety.riskScores.openUser')) })).toBeNull();
    await user.click(screen.getByRole('button', { name: t('common.loadMore') }));
    expect(await screen.findByText('Kim')).toBeInTheDocument();
    first.unmount();
    await renderSignedIn(<RiskScoresPage />, {}, without('moderation.view'));
    expect(screen.getByText(t('states.forbiddenTitle'))).toBeInTheDocument();
  });
});
