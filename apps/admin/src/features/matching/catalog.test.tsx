import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { t } from '@/i18n';
import { apiError, renderSignedIn, type RecordedCall } from '@/test/utils';
import { CategoriesPage } from './CategoriesPage';
import { DealBreakersPage } from './DealBreakersPage';
import { categories, dealBreakers } from './testFixtures';

const puts = (calls: RecordedCall[]) => calls.filter((c) => c.method === 'PUT');

describe('CategoriesPage', () => {
  it('lists categories with their signals', async () => {
    await renderSignedIn(<CategoriesPage />, { 'GET /admin/questionnaire/compatibility-categories': () => categories });
    expect(await screen.findByText('Lifestyle')).toBeInTheDocument();
    expect(screen.getByText('lifestyle_drinking')).toBeInTheDocument();
    expect(screen.getByText(t('matching.source.profile_attributes'))).toBeInTheDocument();
  });

  it('shows empty and error states', async () => {
    const user = userEvent.setup();
    let mode: 'error' | 'empty' = 'error';
    await renderSignedIn(<CategoriesPage />, { 'GET /admin/questionnaire/compatibility-categories': () => (mode === 'error' ? apiError(500, 'INTERNAL') : []) });
    expect(await screen.findByText(t('errors.INTERNAL'))).toBeInTheDocument();
    mode = 'empty';
    await user.click(screen.getByRole('button', { name: t('common.retry') }));
    expect(await screen.findByText(t('matching.categories.empty'))).toBeInTheDocument();
  });

  it('hides edit actions without matching.edit', async () => {
    await renderSignedIn(<CategoriesPage />, { 'GET /admin/questionnaire/compatibility-categories': () => categories }, ['matching.view']);
    await screen.findByText('Lifestyle');
    expect(screen.queryByRole('button', { name: t('matching.categories.new') })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: `${t('common.edit')} values` })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: `${t('matching.categories.editSignals')} values` })).not.toBeInTheDocument();
  });

  it('creates a category with translations', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<CategoriesPage />, {
      'GET /admin/questionnaire/compatibility-categories': () => categories,
      'PUT /admin/questionnaire/compatibility-categories/personality': (c) => c.body,
    });
    await user.click(await screen.findByRole('button', { name: t('matching.categories.new') }));
    const d = screen.getByRole('dialog');
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    expect(puts(calls)).toHaveLength(0);
    await user.type(within(d).getByLabelText(t('common.key'), { exact: false }), 'personality');
    await user.selectOptions(within(d).getByLabelText(t('matching.categories.source'), { exact: false }), 'mixed');
    await user.type(within(d).getByLabelText(t('matching.categories.label'), { exact: false }), 'Personality');
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    await waitFor(() => expect(puts(calls)).toHaveLength(1));
    expect(puts(calls)[0]!.body).toEqual({ key: 'personality', source: 'mixed', position: 0, isActive: true, translations: { en: { label: 'Personality' } } });
    expect(await screen.findByText(t('common.created'))).toBeInTheDocument();
  });

  it('edits an existing category keeping its key', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<CategoriesPage />, {
      'GET /admin/questionnaire/compatibility-categories': () => categories,
      'PUT /admin/questionnaire/compatibility-categories/lifestyle': (c) => c.body,
    });
    await user.click(await screen.findByRole('button', { name: `${t('common.edit')} lifestyle` }));
    const d = screen.getByRole('dialog', { name: t('matching.categories.editTitle', { key: 'lifestyle' }) });
    await user.click(within(d).getByLabelText(t('common.active')));
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    await waitFor(() => expect(puts(calls)).toHaveLength(1));
    expect(puts(calls)[0]!.body).toEqual({ key: 'lifestyle', source: 'profile_attributes', position: 1, isActive: false, translations: { en: { label: 'Lifestyle', description: 'Habits' } } });
  });

  it('updates the signals that feed a category', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<CategoriesPage />, {
      'GET /admin/questionnaire/compatibility-categories': () => categories,
      'PUT /admin/matching/categories/lifestyle/signals': () => new Response(null, { status: 204 }),
    });
    await user.click(await screen.findByRole('button', { name: `${t('matching.categories.editSignals')} lifestyle` }));
    const d = screen.getByRole('dialog', { name: t('matching.signals.title', { key: 'lifestyle' }) });
    expect(within(d).getByLabelText('lifestyle_drinking')).toBeChecked();
    await user.click(within(d).getByLabelText('lifestyle_smoking'));
    await user.click(within(d).getByLabelText(t('matching.signals.usesLocation')));
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    await waitFor(() => expect(puts(calls)).toHaveLength(1));
    expect(puts(calls)[0]!.body).toEqual({ attributeKinds: ['lifestyle_drinking', 'lifestyle_smoking'], usesIntent: false, usesInterests: false, usesLocation: true, inOverall: true });
    expect(await screen.findByText(t('matching.signals.saved', { key: 'lifestyle' }))).toBeInTheDocument();
  });
});

describe('DealBreakersPage', () => {
  it('lists deal-breakers and shows the empty state', async () => {
    await renderSignedIn(<DealBreakersPage />, { 'GET /admin/questionnaire/deal-breakers': () => dealBreakers });
    expect(await screen.findByText('smoking')).toBeInTheDocument();
    expect(screen.getByText(t('matching.dealBreakers.modes.user_optional'))).toBeInTheDocument();
  });

  it('shows an error with retry and the empty state', async () => {
    const user = userEvent.setup();
    let fail = true;
    await renderSignedIn(<DealBreakersPage />, { 'GET /admin/questionnaire/deal-breakers': () => (fail ? apiError(503, 'INTERNAL') : []) });
    expect(await screen.findByText(t('errors.INTERNAL'))).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: t('common.retry') }));
    expect(await screen.findByText(t('matching.dealBreakers.empty'))).toBeInTheDocument();
  });

  it('hides edit actions without matching.edit', async () => {
    await renderSignedIn(<DealBreakersPage />, { 'GET /admin/questionnaire/deal-breakers': () => dealBreakers }, ['matching.view']);
    await screen.findByText('smoking');
    expect(screen.queryByRole('button', { name: t('matching.dealBreakers.new') })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: `${t('common.edit')} smoking` })).not.toBeInTheDocument();
  });

  it('creates a question deal-breaker, requiring the question ID', async () => {
    const user = userEvent.setup();
    const qid = '66666666-6666-4666-8666-666666666666';
    const { calls } = await renderSignedIn(<DealBreakersPage />, {
      'GET /admin/questionnaire/deal-breakers': () => dealBreakers,
      'PUT /admin/questionnaire/deal-breakers/wants_kids': (c) => c.body,
    });
    await user.click(await screen.findByRole('button', { name: t('matching.dealBreakers.new') }));
    const d = screen.getByRole('dialog');
    await user.type(within(d).getByLabelText(t('common.key'), { exact: false }), 'wants_kids');
    await user.selectOptions(within(d).getByLabelText(t('matching.dealBreakers.subjectType'), { exact: false }), 'question');
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    expect(within(d).getByText(t('validation.required'))).toBeInTheDocument();
    expect(puts(calls)).toHaveLength(0);
    await user.type(within(d).getByLabelText(t('matching.dealBreakers.questionId'), { exact: false }), 'nope');
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    expect(within(d).getByText(t('validation.invalidUuid'))).toBeInTheDocument();
    await user.clear(within(d).getByLabelText(t('matching.dealBreakers.questionId'), { exact: false }));
    await user.type(within(d).getByLabelText(t('matching.dealBreakers.questionId'), { exact: false }), qid);
    await user.selectOptions(within(d).getByLabelText(t('matching.dealBreakers.mode'), { exact: false }), 'always_on');
    await user.type(within(d).getByLabelText(t('matching.dealBreakers.requiresEntitlement')), 'advanced_filters');
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    await waitFor(() => expect(puts(calls)).toHaveLength(1));
    expect(puts(calls)[0]!.body).toEqual({ key: 'wants_kids', subjectType: 'question', questionId: qid, attributeKind: null, mode: 'always_on', requiresEntitlement: 'advanced_filters', isActive: true });
  });

  it('edits an attribute deal-breaker', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<DealBreakersPage />, {
      'GET /admin/questionnaire/deal-breakers': () => dealBreakers,
      'PUT /admin/questionnaire/deal-breakers/smoking': (c) => c.body,
    });
    await user.click(await screen.findByRole('button', { name: `${t('common.edit')} smoking` }));
    const d = screen.getByRole('dialog', { name: t('matching.dealBreakers.editTitle', { key: 'smoking' }) });
    await user.selectOptions(within(d).getByLabelText(t('matching.dealBreakers.attributeKind'), { exact: false }), 'lifestyle_cannabis');
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    await waitFor(() => expect(puts(calls)).toHaveLength(1));
    expect(puts(calls)[0]!.body).toEqual({ key: 'smoking', subjectType: 'attribute', questionId: null, attributeKind: 'lifestyle_cannabis', mode: 'user_optional', requiresEntitlement: null, isActive: true });
    expect(await screen.findByText(t('common.saved'))).toBeInTheDocument();
  });
});
