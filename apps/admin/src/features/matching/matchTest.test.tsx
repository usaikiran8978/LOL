import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { t } from '@/i18n';
import { apiError, field, renderSignedIn, type RecordedCall } from '@/test/utils';
import { MatchTestPage } from './MatchTestPage';
import { categories, OLD_ID, summaries, testResult, USER_A, USER_B } from './testFixtures';

const base = {
  'GET /admin/matching/configs': () => summaries,
  'GET /admin/questionnaire/compatibility-categories': () => categories,
};

const posts = (calls: RecordedCall[]) => calls.filter((c) => c.method === 'POST' && c.path === '/admin/matching/test');

describe('MatchTestPage', () => {
  it('is forbidden without matching.test', async () => {
    await renderSignedIn(<MatchTestPage />, base, ['matching.view']);
    expect(screen.getByText(t('states.forbiddenTitle'))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('matching.test.run') })).not.toBeInTheDocument();
  });

  it('validates user IDs with the shared schema', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<MatchTestPage />, base);
    await user.type(field(t('matching.test.userA')), 'not-a-uuid');
    await user.click(screen.getByRole('button', { name: t('matching.test.run') }));
    expect(screen.getByText(t('validation.invalidUuid'))).toBeInTheDocument();
    expect(screen.getByText(t('validation.required'))).toBeInTheDocument();
    expect(posts(calls)).toHaveLength(0);
  });

  it('runs a test against the chosen version and renders the breakdown', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<MatchTestPage />, { ...base, 'POST /admin/matching/test': () => testResult() });
    await user.type(field(t('matching.test.userA')), USER_A);
    await user.type(field(t('matching.test.userB')), USER_B);
    await waitFor(() => expect(screen.getByLabelText(t('matching.test.configVersion'))).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(t('matching.test.configVersion')), OLD_ID);
    await user.click(screen.getByRole('button', { name: t('matching.test.run') }));
    expect(await screen.findByRole('heading', { name: t('matching.test.resultTitle') })).toBeInTheDocument();
    expect(posts(calls)[0]!.body).toEqual({ userA: USER_A, userB: USER_B, configVersionId: OLD_ID });
    const scores = screen.getByRole('heading', { name: t('matching.test.categoryScores') }).closest('.card') as HTMLElement;
    expect(within(scores).getByRole('rowheader', { name: /Values/ })).toBeInTheDocument();
    expect(screen.getByText('72.5')).toBeInTheDocument();
    expect(screen.getByText('wants_children')).toBeInTheDocument();
    expect(screen.getByText(t('matching.importance.l3'))).toBeInTheDocument();
    expect(screen.getByText('verified_boost')).toBeInTheDocument();
    expect(screen.getByText(t('matching.test.km', { km: '3.2' }))).toBeInTheDocument();
  });

  it('defaults to the published version and explains exclusions', async () => {
    const user = userEvent.setup();
    const excluded = testResult({
      eligible: false,
      exclusion: { excluded: true, reason: 'gender_preference', detail: { seeker: USER_A } },
      result: { excluded: true, reason: 'intent_incompatible' },
      ranking: null,
      dealBreakers: [{ sourceQuestionId: 'q1', sourceOptionKey: 'no', targetQuestionId: 'q2', targetOptionKey: null, ruleType: 'dealbreaker', scoreDelta: 0, isExclusion: true, isBidirectional: true }],
    });
    const { calls } = await renderSignedIn(<MatchTestPage />, { ...base, 'POST /admin/matching/test': () => excluded });
    await user.type(field(t('matching.test.userA')), USER_A);
    await user.type(field(t('matching.test.userB')), USER_B);
    await user.click(screen.getByRole('button', { name: t('matching.test.run') }));
    expect(await screen.findByText(t('matching.exclusion.gender_preference'), { exact: false })).toBeInTheDocument();
    expect(posts(calls)[0]!.body).toEqual({ userA: USER_A, userB: USER_B });
    expect(screen.getByText(t('matching.test.noRanking'))).toBeInTheDocument();
    expect(screen.getByText(t('matching.questionRuleType.dealbreaker'))).toBeInTheDocument();
  });

  it('shows API errors (e.g. users without profiles)', async () => {
    const user = userEvent.setup();
    await renderSignedIn(<MatchTestPage />, { ...base, 'POST /admin/matching/test': () => apiError(404, 'NOT_FOUND') });
    await user.type(field(t('matching.test.userA')), USER_A);
    await user.type(field(t('matching.test.userB')), USER_B);
    await user.click(screen.getByRole('button', { name: t('matching.test.run') }));
    expect(await screen.findByText(t('errors.NOT_FOUND'))).toBeInTheDocument();
  });

  it('works with matching.test alone (version ID typed, no lists loaded)', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<MatchTestPage />, { 'POST /admin/matching/test': () => testResult() }, ['matching.test']);
    await user.type(field(t('matching.test.userA')), USER_A);
    await user.type(field(t('matching.test.userB')), USER_B);
    await user.click(screen.getByRole('button', { name: t('matching.test.run') }));
    expect(await screen.findByRole('heading', { name: t('matching.test.resultTitle') })).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/admin/matching/configs')).toBe(false);
    expect(posts(calls)[0]!.body).toEqual({ userA: USER_A, userB: USER_B });
  });
});
