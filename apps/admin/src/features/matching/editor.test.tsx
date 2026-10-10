import type { Permission } from '@amora/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { t } from '@/i18n';
import type { MatchingConfigDetail } from '@/lib/api/modules/matching';
import { routerMock } from '@/test/setup';
import { apiError, field, renderSignedIn, type RecordedCall } from '@/test/utils';
import { ConfigEditorPage } from './ConfigEditorPage';
import { detailToInput } from './configForm';
import { categories, detail, DRAFT_ID, PUB_ID, summaries } from './testFixtures';

const published = detail({ id: PUB_ID, version: 2, status: 'published', notes: null, weights: { values: 0.5, lifestyle: 0.5 }, published_at: '2026-02-02T00:00:00Z' });

function handlers(d: MatchingConfigDetail = detail(), extra: Record<string, (c: RecordedCall) => unknown> = {}) {
  return {
    [`GET /admin/matching/configs/${d.id}`]: () => d,
    'GET /admin/questionnaire/compatibility-categories': () => categories,
    'GET /admin/taxonomy/terms': () => [
      { id: 't1', kind: 'dating_intent', key: 'long_term', parent_id: null, position: 0, is_sensitive: false, is_active: true, metadata: {}, translations: {} },
      { id: 't2', kind: 'dating_intent', key: 'casual', parent_id: null, position: 1, is_sensitive: false, is_active: true, metadata: {}, translations: {} },
      { id: 't3', kind: 'dating_intent', key: 'friendship', parent_id: null, position: 2, is_sensitive: false, is_active: true, metadata: {}, translations: {} },
    ],
    ...extra,
  };
}

const MATCHING_ONLY: Permission[] = ['matching.view', 'matching.edit', 'matching.publish'];
const puts = (calls: RecordedCall[]) => calls.filter((c) => c.method === 'PUT');
const save = () => screen.getByRole('button', { name: t('common.save') });

async function changeNumber(label: string, value: string) {
  const input = field(label);
  fireEvent.change(input, { target: { value } });
}

describe('ConfigEditorPage', () => {
  beforeEach(() => routerMock.push.mockClear());

  it('loads a draft with every schema section as structured inputs', async () => {
    await renderSignedIn(<ConfigEditorPage id={DRAFT_ID} />, handlers());
    expect(await screen.findByRole('heading', { name: t('matching.editor.title', { version: 3 }) })).toBeInTheDocument();
    expect(field(t('matching.fields.minCompatibility.label'))).toHaveValue(40);
    expect(field(t('matching.fields.safetyDownrankFactor.label'))).toHaveValue(0.5);
    expect(field(t('matching.editor.weights.weightFor', { key: 'values' }))).toHaveValue(0.6);
    expect(field(t('matching.editor.weights.weightFor', { key: 'relationship_intent' }))).toHaveValue(null);
    expect(field(t('matching.editor.importance.multiplierFor', { level: t('matching.importance.l3') }))).toHaveValue(4);
    expect(field(t('matching.editor.intents.scoreFor', { a: 'casual', b: 'long_term' }))).toHaveValue(0.2);
    expect(screen.getByLabelText(t('matching.diversityDimension.age_band'))).toBeChecked();
    expect(screen.getByLabelText(t('common.key'), { exact: false })).toHaveValue('verified_boost');
    expect(screen.getByText(t('matching.editor.weights.balanced'))).toBeInTheDocument();
    expect(save()).toBeDisabled();
  });

  it('saves the edited draft with the shared contract payload', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<ConfigEditorPage id={DRAFT_ID} />, handlers(detail(), {
      [`PUT /admin/matching/configs/${DRAFT_ID}`]: (c) => detail({ weights: (c.body as { weights: Record<string, number> }).weights }),
    }));
    await screen.findByRole('heading', { name: t('matching.editor.title', { version: 3 }) });
    await changeNumber(t('matching.editor.weights.weightFor', { key: 'values' }), '0.5');
    expect(screen.getByText(t('matching.editor.weights.unbalanced'))).toBeInTheDocument();
    await changeNumber(t('matching.editor.weights.weightFor', { key: 'relationship_intent' }), '0.1');
    await changeNumber(t('matching.fields.minCompatibility.label'), '55');
    await user.click(screen.getByLabelText(t('matching.diversityDimension.city')));
    await user.click(save());
    await waitFor(() => expect(puts(calls)).toHaveLength(1));
    const body = puts(calls)[0]!.body as Record<string, unknown>;
    const expected = detailToInput(detail());
    expect(body).toMatchObject({
      ...expected,
      minCompatibility: 55,
      weights: { values: 0.5, lifestyle: 0.4, relationship_intent: 0.1 },
      diversityDimensions: ['age_band', 'city'],
      rankingRules: [expect.objectContaining({ key: 'verified_boost', ruleType: 'boost', value: 0.2, isActive: true })],
    });
    expect(await screen.findByText(t('matching.editor.saved', { version: 3 }))).toBeInTheDocument();
    expect(save()).toBeDisabled();
  });

  it('validates on the client with the shared schema before sending', async () => {
    const { calls } = await renderSignedIn(<ConfigEditorPage id={DRAFT_ID} />, handlers());
    await screen.findByRole('heading', { name: t('matching.editor.title', { version: 3 }) });
    await changeNumber(t('matching.fields.minCompatibility.label'), '');
    await changeNumber(t('matching.fields.safetyExcludeThreshold.label'), '2');
    fireEvent.click(save());
    expect(await screen.findByText(t('validation.required'))).toBeInTheDocument();
    expect(screen.getByText(t('validation.tooBig', { max: 1 }))).toBeInTheDocument();
    expect(screen.getByText(t('validation.formHasErrors', { count: 2 }))).toBeInTheDocument();
    expect(puts(calls)).toHaveLength(0);
  });

  it('shows server field errors on the matching inputs', async () => {
    const user = userEvent.setup();
    await renderSignedIn(<ConfigEditorPage id={DRAFT_ID} />, handlers(detail(), {
      [`PUT /admin/matching/configs/${DRAFT_ID}`]: () => apiError(400, 'VALIDATION_FAILED', [{ path: 'candidatePoolLimit', code: 'too_big', message: 'x' }, { path: 'intentMatrix.0.score', code: 'too_big', message: 'x' }]),
    }));
    await screen.findByRole('heading', { name: t('matching.editor.title', { version: 3 }) });
    await changeNumber(t('matching.fields.candidatePoolLimit.label'), '3000');
    await user.click(save());
    const pool = field(t('matching.fields.candidatePoolLimit.label'));
    await waitFor(() => expect(pool).toHaveAttribute('aria-invalid', 'true'));
    expect(field(t('matching.editor.intents.scoreFor', { a: 'casual', b: 'long_term' }))).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(t('errors.VALIDATION_FAILED'))).toBeInTheDocument();
  });

  it('edits the intent matrix from the taxonomy and adds ranking rules', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<ConfigEditorPage id={DRAFT_ID} />, handlers(detail(), {
      [`PUT /admin/matching/configs/${DRAFT_ID}`]: () => detail(),
    }));
    await screen.findByRole('heading', { name: t('matching.editor.title', { version: 3 }) });
    // Every active taxonomy intent is on the axis; the picker only appears for intents removed from it.
    expect(screen.queryByLabelText(t('matching.editor.intents.addIntent'))).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('matching.editor.intents.removeIntent', { key: 'friendship' }) }));
    await user.selectOptions(screen.getByLabelText(t('matching.editor.intents.addIntent')), 'friendship');
    await user.click(screen.getByRole('button', { name: t('common.add') }));
    await changeNumber(t('matching.editor.intents.scoreFor', { a: 'casual', b: 'friendship' }), '0.7');
    await user.click(screen.getByLabelText(t('matching.editor.intents.hardFor', { a: 'friendship', b: 'long_term' })));
    await user.click(screen.getByRole('button', { name: t('matching.editor.rules.add') }));
    await user.click(save());
    // New rule without key / condition is rejected locally.
    expect(puts(calls)).toHaveLength(0);
    const rule2 = screen.getByRole('listitem', { name: t('matching.editor.rules.ruleN', { n: 2 }) });
    expect(within(rule2).getByLabelText(t('common.key'), { exact: false })).toHaveAttribute('aria-invalid', 'true');
    await user.click(within(rule2).getByRole('button', { name: `${t('common.remove')} — ${t('matching.editor.rules.ruleN', { n: 2 })}` }));
    await user.click(save());
    await waitFor(() => expect(puts(calls)).toHaveLength(1));
    expect((puts(calls)[0]!.body as { intentMatrix: unknown[] }).intentMatrix).toEqual([
      { a: 'casual', b: 'friendship', score: 0.7, hardExclusion: false },
      { a: 'casual', b: 'long_term', score: 0.2, hardExclusion: false },
      { a: 'friendship', b: 'long_term', score: 0, hardExclusion: true },
      { a: 'long_term', b: 'long_term', score: 1, hardExclusion: false },
    ]);
  });

  it('derives intents from the config when the taxonomy is not readable', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<ConfigEditorPage id={DRAFT_ID} />, handlers(), MATCHING_ONLY);
    await screen.findByRole('heading', { name: t('matching.editor.title', { version: 3 }) });
    expect(calls.some((c) => c.path === '/admin/taxonomy/terms')).toBe(false);
    expect(screen.getByText(t('matching.editor.intents.taxonomyUnavailable'))).toBeInTheDocument();
    await user.type(screen.getByLabelText(t('matching.editor.intents.addIntent')), 'Bad Key');
    await user.click(screen.getByRole('button', { name: t('common.add') }));
    expect(screen.getByText(t('matching.editor.intents.keyInvalid'))).toBeInTheDocument();
    await user.clear(screen.getByLabelText(t('matching.editor.intents.addIntent')));
    await user.type(screen.getByLabelText(t('matching.editor.intents.addIntent')), 'serious');
    await user.click(screen.getByRole('button', { name: t('common.add') }));
    expect(field(t('matching.editor.intents.scoreFor', { a: 'serious', b: 'serious' }))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('matching.editor.intents.removeIntent', { key: 'casual' }) }));
    expect(screen.queryByLabelText(t('matching.editor.intents.scoreFor', { a: 'casual', b: 'long_term' }))).not.toBeInTheDocument();
  });

  it('validates a saved draft and lists localized issues', async () => {
    const user = userEvent.setup();
    await renderSignedIn(<ConfigEditorPage id={DRAFT_ID} />, handlers(detail(), {
      [`GET /admin/matching/configs/${DRAFT_ID}/validate`]: () => ({ issues: [{ path: 'weights', code: 'weights_sum', message: 'Category weights must sum to 1 (currently 0.9)' }] }),
    }));
    await user.click(await screen.findByRole('button', { name: t('matching.validate.action') }));
    expect(await screen.findByText(t('matching.issues.weights_sum'), { exact: false })).toBeInTheDocument();
  });

  it('publishes after showing the diff against the published version', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<ConfigEditorPage id={DRAFT_ID} />, handlers(detail(), {
      [`GET /admin/matching/configs/${DRAFT_ID}/validate`]: () => ({ issues: [] }),
      'GET /admin/matching/configs': () => summaries,
      [`GET /admin/matching/configs/${PUB_ID}`]: () => published,
      [`POST /admin/matching/configs/${DRAFT_ID}/publish`]: () => detail({ status: 'published', published_at: '2026-03-02T00:00:00Z' }),
    }));
    await user.click(await screen.findByRole('button', { name: t('matching.publish.action') }));
    const d = screen.getByRole('dialog', { name: t('matching.publish.title', { version: 3 }) });
    expect(await within(d).findByText(t('matching.publish.diffTitle', { from: 'v2', to: 'v3' }))).toBeInTheDocument();
    expect(within(d).getByText('weights.values')).toBeInTheDocument();
    expect(within(d).getByText('notes')).toBeInTheDocument();
    expect(calls.some((c) => c.path.endsWith('/publish'))).toBe(false);
    await user.click(within(d).getByRole('button', { name: t('matching.publish.confirm') }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === `/admin/matching/configs/${DRAFT_ID}/publish`)).toBe(true));
    expect(await screen.findByText(t('matching.publish.published', { version: 3 }))).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: t('common.save') })).not.toBeInTheDocument());
    expect(screen.getByText(t('status.published'))).toBeInTheDocument();
  });

  it('blocks publishing while validation issues exist', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<ConfigEditorPage id={DRAFT_ID} />, handlers(detail(), {
      [`GET /admin/matching/configs/${DRAFT_ID}/validate`]: () => ({ issues: [{ path: 'safety', code: 'safety_order', message: 'x' }] }),
      'GET /admin/matching/configs': () => summaries,
      [`GET /admin/matching/configs/${PUB_ID}`]: () => published,
    }));
    await user.click(await screen.findByRole('button', { name: t('matching.publish.action') }));
    const d = screen.getByRole('dialog');
    expect(await within(d).findByText(t('matching.issues.safety_order'), { exact: false })).toBeInTheDocument();
    expect(within(d).queryByRole('button', { name: t('matching.publish.confirm') })).not.toBeInTheDocument();
    expect(calls.some((c) => c.path.endsWith('/publish'))).toBe(false);
  });

  it('requires saving before validate/publish', async () => {
    await renderSignedIn(<ConfigEditorPage id={DRAFT_ID} />, handlers());
    await screen.findByRole('heading', { name: t('matching.editor.title', { version: 3 }) });
    await changeNumber(t('matching.fields.minCompatibility.label'), '50');
    expect(screen.getByRole('button', { name: t('matching.publish.action') })).toBeDisabled();
    expect(screen.getByRole('button', { name: t('matching.validate.action') })).toBeDisabled();
    expect(screen.getByText(t('matching.editor.unsavedHint'))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: t('matching.editor.discard') }));
    expect(field(t('matching.fields.minCompatibility.label'))).toHaveValue(40);
  });

  it('is read-only for published versions and can clone them into a draft', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<ConfigEditorPage id={PUB_ID} />, handlers(published, {
      'POST /admin/matching/configs': () => ({ id: DRAFT_ID, version: 3 }),
    }));
    await screen.findByRole('heading', { name: t('matching.editor.title', { version: 2 }) });
    expect(screen.queryByRole('button', { name: t('common.save') })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('matching.publish.action') })).not.toBeInTheDocument();
    expect(field(t('matching.fields.minCompatibility.label'))).toBeDisabled();
    await user.click(screen.getByRole('button', { name: t('matching.editor.cloneAction') }));
    const d = screen.getByRole('dialog', { name: t('matching.editor.cloneTitle', { version: 2 }) });
    await user.click(within(d).getByRole('button', { name: t('matching.editor.cloneAction') }));
    await waitFor(() => expect(routerMock.push).toHaveBeenCalledWith(`/matching/configs/${DRAFT_ID}`));
    expect(calls.find((c) => c.method === 'POST' && c.path === '/admin/matching/configs')!.body).toEqual(detailToInput(published));
  });

  it('gates edit / publish actions by permission', async () => {
    await renderSignedIn(<ConfigEditorPage id={DRAFT_ID} />, handlers(), ['matching.view']);
    await screen.findByRole('heading', { name: t('matching.editor.title', { version: 3 }) });
    expect(screen.queryByRole('button', { name: t('common.save') })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('matching.publish.action') })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('matching.versions.deleteDraft') })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('matching.validate.action') })).toBeEnabled();
    expect(field(t('matching.fields.minCompatibility.label'))).toBeDisabled();
  });

  it('hides publish without matching.publish but keeps editing', async () => {
    await renderSignedIn(<ConfigEditorPage id={DRAFT_ID} />, handlers(), ['matching.view', 'matching.edit']);
    await screen.findByRole('heading', { name: t('matching.editor.title', { version: 3 }) });
    expect(screen.queryByRole('button', { name: t('matching.publish.action') })).not.toBeInTheDocument();
    expect(field(t('matching.fields.minCompatibility.label'))).toBeEnabled();
  });

  it('deletes the draft after typed confirmation and returns to the list', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<ConfigEditorPage id={DRAFT_ID} />, handlers(detail(), {
      [`DELETE /admin/matching/configs/${DRAFT_ID}`]: () => new Response(null, { status: 204 }),
    }));
    await user.click(await screen.findByRole('button', { name: t('matching.versions.deleteDraft') }));
    const d = screen.getByRole('dialog');
    await user.type(within(d).getByLabelText(t('confirmText.label', { phrase: 'v3' }), { exact: false }), 'v3');
    await user.click(within(d).getByRole('button', { name: t('matching.versions.deleteDraft') }));
    await waitFor(() => expect(routerMock.push).toHaveBeenCalledWith('/matching'));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(true);
  });

  it('applies validated JSON from the advanced view', async () => {
    const user = userEvent.setup();
    await renderSignedIn(<ConfigEditorPage id={DRAFT_ID} />, handlers());
    await screen.findByRole('heading', { name: t('matching.editor.title', { version: 3 }) });
    await user.click(screen.getByRole('button', { name: t('matching.editor.jsonView') }));
    const area = screen.getByLabelText(t('json.label'));
    fireEvent.change(area, { target: { value: '{bad' } });
    await user.click(screen.getByRole('button', { name: t('matching.editor.json.apply') }));
    expect(screen.getByText(t('validation.invalidJson'))).toBeInTheDocument();
    fireEvent.change(area, { target: { value: JSON.stringify({ ...detailToInput(detail()), minCompatibility: 500 }) } });
    await user.click(screen.getByRole('button', { name: t('matching.editor.json.apply') }));
    expect(screen.getByText(t('validation.tooBig', { max: 100 }), { exact: false })).toBeInTheDocument();
    fireEvent.change(area, { target: { value: JSON.stringify({ ...detailToInput(detail()), minCompatibility: 65 }) } });
    await user.click(screen.getByRole('button', { name: t('matching.editor.json.apply') }));
    expect(field(t('matching.fields.minCompatibility.label'))).toHaveValue(65);
    expect(save()).toBeEnabled();
  });

  it('shows a load error with retry', async () => {
    const user = userEvent.setup();
    let fail = true;
    await renderSignedIn(<ConfigEditorPage id={DRAFT_ID} />, handlers(detail(), {
      [`GET /admin/matching/configs/${DRAFT_ID}`]: () => (fail ? apiError(404, 'NOT_FOUND') : detail()),
    }));
    expect(await screen.findByText(t('errors.NOT_FOUND'))).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: t('common.retry') }));
    expect(await screen.findByRole('heading', { name: t('matching.editor.title', { version: 3 }) })).toBeInTheDocument();
  });
});
