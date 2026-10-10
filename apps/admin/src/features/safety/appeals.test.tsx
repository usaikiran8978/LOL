import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { t } from '@/i18n';
import { navigationState } from '@/test/setup';
import { apiError, renderSignedIn } from '@/test/utils';
import { AppealsPage } from './AppealsPage';
import { CASE_ID, OTHER_ADMIN, USER_ID, without, writes } from './fixtures';

const APPEAL = { id: 'ap-1', user_id: USER_ID, statement: 'I was joking with a friend', status: 'submitted', created_at: '2026-10-08T08:00:00Z', action: 'suspend', reason_key: 'harassment', case_id: CASE_ID, actor_id: OTHER_ADMIN };
const page = (items: unknown[], nextCursor: string | null = null) => ({ items, nextCursor });

beforeEach(() => {
  navigationState.pathname = '/moderation/appeals';
});

describe('AppealsPage', () => {
  it('lists pending appeals with the different-reviewer rule and filters by status', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<AppealsPage />, { 'GET /admin/moderation/appeals': (c) => (c.query.get('status') === 'upheld' ? page([]) : page([APPEAL])) });
    expect(await screen.findByText('I was joking with a friend')).toBeInTheDocument();
    expect(screen.getByText(t('safety.appeals.differentReviewer'))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: t('safety.appeals.viewCase') })).toHaveAttribute('href', `/moderation/cases/${CASE_ID}`);
    expect(calls.find((c) => c.path === '/admin/moderation/appeals')!.query.get('cursor')).toBeNull();
    expect(within(screen.getByLabelText(t('safety.appeals.status'))).getByRole('option', { name: t('safety.appealStatus.partially_overturned') })).toHaveValue('partially_overturned');
    await user.selectOptions(screen.getByLabelText(t('safety.appeals.status')), 'upheld');
    expect(await screen.findByText(t('safety.appeals.empty'))).toBeInTheDocument();
    expect(calls.at(-1)!.query.get('status')).toBe('upheld');
  });

  it('overturns an appeal after confirmation', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<AppealsPage />, { 'GET /admin/moderation/appeals': () => page([APPEAL]), 'POST /admin/moderation/appeals/ap-1/decision': () => ({ status: 'overturned' }) });
    await user.click(await screen.findByRole('button', { name: `${t('safety.appeals.overturn')} ap-1` }));
    const d = screen.getByRole('dialog', { name: t('safety.appeals.overturnTitle') });
    await user.type(within(d).getByLabelText(t('safety.appeals.note')), 'Context checks out');
    await user.click(within(d).getByRole('button', { name: t('safety.appeals.overturn') }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]!.body).toEqual({ decision: 'overturned', note: 'Context checks out' });
    expect(await screen.findByText(t('safety.appeals.overturnedDone'))).toBeInTheDocument();
  });

  it('pages with the cursor', async () => {
    const user = userEvent.setup();
    const second = { ...APPEAL, id: 'ap-2', statement: 'Second page appeal' };
    const { calls } = await renderSignedIn(<AppealsPage />, {
      'GET /admin/moderation/appeals': (c) => (c.query.get('cursor') === 'c2' ? page([second]) : page([APPEAL], 'c2')),
    });
    expect(await screen.findByText('I was joking with a friend')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('common.loadMore') }));
    expect(await screen.findByText('Second page appeal')).toBeInTheDocument();
    expect(calls.filter((c) => c.path === '/admin/moderation/appeals').at(-1)!.query.get('cursor')).toBe('c2');
    expect(screen.getByText(t('common.endOfList'))).toBeInTheDocument();
  });

  it('disables deciding up front when the viewer took the original action', async () => {
    // authHandlers signs in as admin "a1".
    await renderSignedIn(<AppealsPage />, { 'GET /admin/moderation/appeals': () => page([{ ...APPEAL, actor_id: 'a1' }]) });
    expect(await screen.findByText(t('safety.appeals.blockedForYou'))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: `${t('safety.appeals.uphold')} ap-1` })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: `${t('safety.appeals.overturn')} ap-1` })).not.toBeInTheDocument();
  });

  it('hides overturning a ban without moderation.ban but still allows upholding', async () => {
    await renderSignedIn(<AppealsPage />, { 'GET /admin/moderation/appeals': () => page([{ ...APPEAL, action: 'ban' }]) }, without('moderation.ban'));
    expect(await screen.findByRole('button', { name: `${t('safety.appeals.uphold')} ap-1` })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: `${t('safety.appeals.overturn')} ap-1` })).not.toBeInTheDocument();
    expect(screen.getByText(t('safety.appeals.overturnNeedsBan'))).toBeInTheDocument();
  });

  it('explains the same-reviewer rejection and blocks that appeal for this admin', async () => {
    const user = userEvent.setup();
    await renderSignedIn(<AppealsPage />, { 'GET /admin/moderation/appeals': () => page([APPEAL]), 'POST /admin/moderation/appeals/ap-1/decision': () => apiError(403, 'FORBIDDEN') });
    await user.click(await screen.findByRole('button', { name: `${t('safety.appeals.uphold')} ap-1` }));
    const d = screen.getByRole('dialog');
    await user.click(within(d).getByRole('button', { name: t('safety.appeals.uphold') }));
    expect(await within(d).findByText(t('safety.appeals.sameReviewerError'))).toBeInTheDocument();
    await user.click(within(d).getByRole('button', { name: t('common.cancel') }));
    expect(screen.getByText(t('safety.appeals.blockedForYou'))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: `${t('safety.appeals.uphold')} ap-1` })).not.toBeInTheDocument();
  });

  it('shows other API errors, the error state and gating', async () => {
    const user = userEvent.setup();
    let fail = true;
    const first = await renderSignedIn(<AppealsPage />, {
      'GET /admin/moderation/appeals': () => (fail ? apiError(500, 'INTERNAL') : page([APPEAL])),
      'POST /admin/moderation/appeals/ap-1/decision': () => apiError(409, 'CONFLICT'),
    });
    expect(await screen.findByText(t('errors.INTERNAL'))).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: t('common.retry') }));
    await user.click(await screen.findByRole('button', { name: `${t('safety.appeals.uphold')} ap-1` }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: t('safety.appeals.uphold') }));
    expect(await screen.findByText(t('errors.CONFLICT'))).toBeInTheDocument();
    first.unmount();
    await renderSignedIn(<AppealsPage />, {}, without('moderation.appeals'));
    expect(screen.getByText(t('states.forbiddenTitle'))).toBeInTheDocument();
  });
});
