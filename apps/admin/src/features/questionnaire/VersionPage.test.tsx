import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { t } from '@/i18n';
import { routerMock } from '@/test/setup';
import { apiError, field, renderSignedIn } from '@/test/utils';
import { baseHandlers, detail, impactReport, Q2_ID, Q_ID, v1, V1_ID, v2Draft, V2_ID, writes } from './test-fixtures';
import { VersionPage } from './VersionPage';

const noContent = () => new Response(null, { status: 204 });
const draftPage = () => <VersionPage questionId={Q_ID} versionId={V2_ID} />;
const enText = () => screen.getByLabelText(`${t('questionnaire.editor.text')} (en)`, { exact: false });

describe('VersionPage — draft editor', () => {
  beforeEach(() => routerMock.push.mockClear());

  it('edits and saves the draft with the full version body', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(draftPage(), { ...baseHandlers(), [`PUT /admin/questions/versions/${V2_ID}`]: () => ({ questionId: Q_ID, versionId: V2_ID }) });
    const save = (await screen.findAllByRole('button', { name: t('questionnaire.editor.saveDraft') }))[0]!;
    expect(save).toBeDisabled();
    await user.clear(enText());
    await user.type(enText(), 'Coffee, tea or water?');
    expect(screen.getByText(t('questionnaire.editor.unsaved'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('questionnaire.workflow.validate') })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: t('questionnaire.options.add') }));
    const third = screen.getByRole('listitem', { name: t('questionnaire.options.optionN', { n: 3 }) });
    await user.type(within(third).getByLabelText(t('questionnaire.options.key'), { exact: false }), 'water');
    await user.type(within(third).getByLabelText(`${t('questionnaire.options.label')} (en)`, { exact: false }), 'Water');
    await user.clear(field(t('questionnaire.editor.weight')));
    await user.type(field(t('questionnaire.editor.weight')), '5');
    await user.click(save);

    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    const put = writes(calls)[0]!;
    expect(put.path).toBe(`/admin/questions/versions/${V2_ID}`);
    expect(put.body).toMatchObject({
      answerType: 'single_choice', weight: 5, answerCarryOver: 'same_options', changeNote: 'Copy',
      translations: { en: { text: 'Coffee, tea or water?' } },
      options: [
        { key: 'coffee', numericValue: 1, translations: { en: { label: 'Coffee' } } },
        { key: 'tea', numericValue: 2, translations: { en: { label: 'Tea' } } },
        { key: 'water', isExclusive: false, translations: { en: { label: 'Water' } } },
      ],
      conditions: [], rules: [],
    });
    expect(await screen.findByText(t('questionnaire.editor.saved'))).toBeInTheDocument();
  });

  it('validates with the shared schema before saving and shows field errors', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(draftPage(), baseHandlers());
    await screen.findAllByRole('button', { name: t('questionnaire.editor.saveDraft') });
    await user.clear(enText());
    await user.click(screen.getByRole('button', { name: t('questionnaire.options.add') }));
    const third = screen.getByRole('listitem', { name: t('questionnaire.options.optionN', { n: 3 }) });
    await user.type(within(third).getByLabelText(t('questionnaire.options.key'), { exact: false }), 'tea');
    await user.click(screen.getAllByRole('button', { name: t('questionnaire.editor.saveDraft') })[0]!);
    expect(await screen.findByText(t('validation.duplicate', { value: 'tea' }))).toBeInTheDocument();
    expect(screen.getAllByText(t('validation.required')).length).toBeGreaterThan(0);
    expect(writes(calls)).toHaveLength(0);
  });

  it('explains VERSION_IMMUTABLE and offers a reload', async () => {
    const user = userEvent.setup();
    await renderSignedIn(draftPage(), { ...baseHandlers(), [`PUT /admin/questions/versions/${V2_ID}`]: () => apiError(409, 'VERSION_IMMUTABLE') });
    await screen.findAllByRole('button', { name: t('questionnaire.editor.saveDraft') });
    await user.type(enText(), '!');
    await user.click(screen.getAllByRole('button', { name: t('questionnaire.editor.saveDraft') })[0]!);
    expect(await screen.findByText(t('questionnaire.editor.immutable'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('questionnaire.editor.reloadVersion') })).toBeInTheDocument();
  });

  it('adds a display condition using the target question’s options', async () => {
    const user = userEvent.setup();
    const pets = detail({
      id: Q2_ID, key: 'pets', published_version_id: 'pv',
      versions: [{ ...v1, id: 'pv', questionId: Q2_ID, answerType: 'yes_no', options: [{ id: 'y', key: 'yes', numericValue: null, isExclusive: false }, { id: 'n', key: 'no', numericValue: null, isExclusive: false }], optionTranslations: [{ optionId: 'y', locale: 'en', label: 'Yes' }, { optionId: 'n', locale: 'en', label: 'No' }] }],
    });
    const { calls } = await renderSignedIn(draftPage(), {
      ...baseHandlers(),
      [`GET /admin/questions/${Q2_ID}`]: () => pets,
      [`PUT /admin/questions/versions/${V2_ID}`]: () => ({ questionId: Q_ID, versionId: V2_ID }),
    });
    await user.click(await screen.findByRole('button', { name: t('questionnaire.conditions.add') }));
    const row = screen.getByRole('listitem', { name: t('questionnaire.conditions.conditionN', { n: 1 }) });
    // The question itself is not offered as a dependency.
    const dependsOn = within(row).getByLabelText(t('questionnaire.conditions.dependsOn'), { exact: false });
    expect(within(dependsOn).queryByRole('option', { name: /^coffee/ })).not.toBeInTheDocument();
    await user.selectOptions(dependsOn, Q2_ID);
    await user.selectOptions(within(row).getByLabelText(t('questionnaire.conditions.operator')), 'includes_any');
    await user.click(await within(row).findByLabelText('Yes (yes)'));
    await user.click(screen.getAllByRole('button', { name: t('questionnaire.editor.saveDraft') })[0]!);
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect((writes(calls)[0]!.body as { conditions: unknown }).conditions).toEqual([{ groupNo: 0, dependsOnQuestionId: Q2_ID, operator: 'includes_any', optionKeys: ['yes'] }]);
  });

  it('maps old options to new ones for carry-over', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(draftPage(), { ...baseHandlers(), [`PUT /admin/questions/versions/${V2_ID}`]: () => ({ questionId: Q_ID, versionId: V2_ID }) });
    await user.selectOptions(await screen.findByLabelText(t('questionnaire.carryOver.mode')), 'mapped');
    await user.click(screen.getByRole('button', { name: t('questionnaire.carryOver.mapIdentical') }));
    expect(screen.getAllByRole('listitem', { name: /Mapping/ })).toHaveLength(2);
    await user.click(screen.getAllByRole('button', { name: t('questionnaire.editor.saveDraft') })[0]!);
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]!.body).toMatchObject({ answerCarryOver: 'mapped', optionMappings: [{ fromOptionKey: 'coffee', toOptionKey: 'coffee' }, { fromOptionKey: 'tea', toOptionKey: 'tea' }] });
  });

  it('is read-only for admins without questions.edit and hides publishing without questions.publish', async () => {
    await renderSignedIn(draftPage(), baseHandlers(), ['questions.view']);
    expect(await screen.findByText(t('questionnaire.editor.noEditPermission'))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('questionnaire.editor.saveDraft') })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('questionnaire.workflow.publish') })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('questionnaire.workflow.deleteDraft') })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('questionnaire.workflow.validate') })).toBeEnabled();
  });

  it('shows not found for an unknown version', async () => {
    await renderSignedIn(<VersionPage questionId={Q_ID} versionId="nope" />, baseHandlers());
    expect(await screen.findByText(t('errors.NOT_FOUND'))).toBeInTheDocument();
  });
});

describe('VersionPage — workflow', () => {
  beforeEach(() => routerMock.push.mockClear());

  it('validates and shows localized issues', async () => {
    const user = userEvent.setup();
    await renderSignedIn(draftPage(), {
      ...baseHandlers(),
      [`GET /admin/questions/versions/${V2_ID}/validate`]: () => ({ issues: [{ path: 'options', code: 'too_few_options', message: 'x' }, { path: 'optionMappings', code: 'unmapped_options', message: 'y' }] }),
    });
    await user.click(await screen.findByRole('button', { name: t('questionnaire.workflow.validate') }));
    expect(await screen.findByText(t('questionnaire.issues.too_few_options'), { exact: false })).toBeInTheDocument();
    expect(screen.getByText(t('questionnaire.workflow.advisory'))).toBeInTheDocument();
  });

  it('reports a clean validation', async () => {
    const user = userEvent.setup();
    await renderSignedIn(draftPage(), { ...baseHandlers(), [`GET /admin/questions/versions/${V2_ID}/validate`]: () => ({ issues: [] }) });
    await user.click(await screen.findByRole('button', { name: t('questionnaire.workflow.validate') }));
    expect(await screen.findByText(t('questionnaire.workflow.valid'))).toBeInTheDocument();
  });

  it('runs the impact analysis', async () => {
    const user = userEvent.setup();
    await renderSignedIn(draftPage(), { ...baseHandlers(), [`GET /admin/questions/versions/${V2_ID}/impact`]: () => ({ ...impactReport, usersReasked: 4 }) });
    await user.click(await screen.findByRole('button', { name: t('questionnaire.workflow.impact') }));
    const region = await screen.findByRole('region', { name: t('questionnaire.impact.title') });
    expect(await within(region).findByText(t('questionnaire.impact.usersReasked'))).toBeInTheDocument();
    expect(within(region).getByText('45')).toBeInTheDocument();
    expect(within(region).getByText(t('questionnaire.impact.attention'))).toBeInTheDocument();
  });

  it('publishes now after reviewing the impact', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(draftPage(), {
      ...baseHandlers(),
      [`GET /admin/questions/versions/${V2_ID}/impact`]: () => impactReport,
      [`POST /admin/questions/versions/${V2_ID}/publish`]: () => ({ status: 'published', impact: impactReport }),
    });
    await user.click(await screen.findByRole('button', { name: t('questionnaire.workflow.publish') }));
    const d = screen.getByRole('dialog');
    expect(await within(d).findByText(t('questionnaire.impact.usersWithCurrentAnswer'))).toBeInTheDocument();
    await user.click(within(d).getByRole('button', { name: t('questionnaire.publish.publishNow') }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]!.body).toEqual({ acknowledgeImpact: false });
    expect(await screen.findByText(t('questionnaire.publish.published', { version: 2 }))).toBeInTheDocument();
  });

  it('schedules for a future time as ISO UTC and requires acknowledging re-asked users', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(draftPage(), {
      ...baseHandlers(),
      [`GET /admin/questions/versions/${V2_ID}/impact`]: () => ({ ...impactReport, usersReasked: 3 }),
      [`POST /admin/questions/versions/${V2_ID}/publish`]: (c) => ({ status: 'scheduled', effectiveAt: (c.body as { effectiveAt: string }).effectiveAt, impact: impactReport }),
    });
    await user.click(await screen.findByRole('button', { name: t('questionnaire.workflow.publish') }));
    const d = screen.getByRole('dialog');
    await within(d).findByText(t('questionnaire.impact.usersWithCurrentAnswer'));
    await user.click(within(d).getByRole('radio', { name: t('questionnaire.publish.later') }));
    fireEvent.change(within(d).getByLabelText(t('questionnaire.publish.effectiveAt'), { exact: false }), { target: { value: '2000-01-01T10:00' } });
    await user.click(within(d).getByRole('button', { name: t('questionnaire.publish.schedule') }));
    expect(within(d).getByText(t('questionnaire.publish.mustBeFuture'))).toBeInTheDocument();
    fireEvent.change(within(d).getByLabelText(t('questionnaire.publish.effectiveAt'), { exact: false }), { target: { value: '2099-01-01T10:00' } });
    await user.click(within(d).getByRole('button', { name: t('questionnaire.publish.schedule') }));
    expect(within(d).getByText(t('questionnaire.publish.ackRequired'))).toBeInTheDocument();
    expect(writes(calls)).toHaveLength(0);
    await user.click(within(d).getByLabelText(t('questionnaire.publish.acknowledge', { count: 3 })));
    await user.click(within(d).getByRole('button', { name: t('questionnaire.publish.schedule') }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]!.body).toEqual({ effectiveAt: new Date('2099-01-01T10:00').toISOString(), acknowledgeImpact: true });
  });

  it('shows the blocking issues returned with PUBLISH_VALIDATION_FAILED', async () => {
    const user = userEvent.setup();
    await renderSignedIn(draftPage(), {
      ...baseHandlers(),
      [`GET /admin/questions/versions/${V2_ID}/impact`]: () => impactReport,
      [`POST /admin/questions/versions/${V2_ID}/publish`]: () => apiError(422, 'PUBLISH_VALIDATION_FAILED', { issues: [{ path: 'conditions', code: 'dependency_cycle', message: 'cycle' }] }),
    });
    await user.click(await screen.findByRole('button', { name: t('questionnaire.workflow.publish') }));
    const d = screen.getByRole('dialog');
    await within(d).findByText(t('questionnaire.impact.usersWithCurrentAnswer'));
    await user.click(within(d).getByRole('button', { name: t('questionnaire.publish.publishNow') }));
    expect(await within(d).findByText(t('questionnaire.issues.dependency_cycle'), { exact: false })).toBeInTheDocument();
    expect(within(d).getByText(t('errors.PUBLISH_VALIDATION_FAILED'))).toBeInTheDocument();
    expect(within(d).getByRole('button', { name: t('questionnaire.publish.publishNow') })).toBeDisabled();
  });

  it('asks for acknowledgement when the server requires it', async () => {
    const user = userEvent.setup();
    let calls = 0;
    const { calls: recorded } = await renderSignedIn(draftPage(), {
      ...baseHandlers(),
      [`GET /admin/questions/versions/${V2_ID}/impact`]: () => impactReport,
      [`POST /admin/questions/versions/${V2_ID}/publish`]: () => (++calls === 1 ? apiError(422, 'PUBLISH_VALIDATION_FAILED', { requiresAcknowledgement: true, impact: { ...impactReport, usersReasked: 2 } }) : { status: 'published', impact: impactReport }),
    });
    await user.click(await screen.findByRole('button', { name: t('questionnaire.workflow.publish') }));
    const d = screen.getByRole('dialog');
    await within(d).findByText(t('questionnaire.impact.usersWithCurrentAnswer'));
    await user.click(within(d).getByRole('button', { name: t('questionnaire.publish.publishNow') }));
    expect(await within(d).findByText(t('questionnaire.publish.ackServer'))).toBeInTheDocument();
    await user.click(within(d).getByLabelText(t('questionnaire.publish.acknowledge', { count: 2 })));
    await user.click(within(d).getByRole('button', { name: t('questionnaire.publish.publishNow') }));
    await waitFor(() => expect(writes(recorded)).toHaveLength(2));
    expect(writes(recorded)[1]!.body).toEqual({ acknowledgeImpact: true });
  });

  it('deletes the draft after typing the key', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(draftPage(), { ...baseHandlers(), [`DELETE /admin/questions/versions/${V2_ID}`]: noContent });
    await user.click(await screen.findByRole('button', { name: t('questionnaire.workflow.deleteDraft') }));
    const d = screen.getByRole('dialog');
    await user.type(within(d).getByLabelText(t('confirmText.label', { phrase: 'coffee' }), { exact: false }), 'coffee');
    await user.click(within(d).getByRole('button', { name: t('questionnaire.workflow.deleteDraft') }));
    await waitFor(() => expect(routerMock.push).toHaveBeenCalledWith(`/questionnaire/${Q_ID}`));
    expect(writes(calls).map((c) => `${c.method} ${c.path}`)).toEqual([`DELETE /admin/questions/versions/${V2_ID}`]);
  });

  it('cancels a schedule', async () => {
    const user = userEvent.setup();
    const scheduled = { ...v2Draft, status: 'scheduled' as const, effectiveAt: '2099-01-01T10:00:00Z' };
    const { calls } = await renderSignedIn(draftPage(), { ...baseHandlers(detail({ versions: [scheduled, v1] })), [`POST /admin/questions/versions/${V2_ID}/cancel-schedule`]: noContent });
    await user.click(await screen.findByRole('button', { name: t('questionnaire.workflow.cancelSchedule') }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: t('questionnaire.workflow.cancelSchedule') }));
    await waitFor(() => expect(writes(calls).map((c) => c.path)).toEqual([`/admin/questions/versions/${V2_ID}/cancel-schedule`]));
    expect(screen.queryByRole('button', { name: t('questionnaire.editor.saveDraft') })).not.toBeInTheDocument();
  });

  it('shows a published version read-only and renders a localized preview', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<VersionPage questionId={Q_ID} versionId={V1_ID} />, {
      ...baseHandlers(),
      [`POST /admin/questions/versions/${V1_ID}/preview`]: () => ({
        rendered: { versionId: V1_ID, answerType: 'single_choice', text: 'Café ou thé ?', helpText: null, scaleMinLabel: null, scaleMaxLabel: null, isRequired: false, allowImportance: true, allowDealbreaker: false, allowSkip: true, constraints: { minSelections: null, maxSelections: null, scaleMin: null, scaleMax: null, scaleStep: null, numericMin: null, numericMax: null, textMaxLength: null }, options: [{ key: 'coffee', label: 'Café', isExclusive: false }] },
        targetingMatches: false, conditions: [], issues: [],
      }),
    });
    expect(await screen.findByText(t('questionnaire.workflow.readOnly'))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('questionnaire.editor.saveDraft') })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('questionnaire.workflow.publish') })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('questionnaire.workflow.preview') }));
    await user.clear(screen.getByLabelText(t('questionnaire.preview.locale')));
    await user.type(screen.getByLabelText(t('questionnaire.preview.locale')), 'fr');
    fireEvent.change(screen.getByLabelText(t('questionnaire.preview.facts')), { target: { value: '{"age":25}' } });
    await user.click(screen.getByRole('button', { name: t('questionnaire.preview.run') }));
    expect(await screen.findByText('Café ou thé ?')).toBeInTheDocument();
    expect(screen.getByText(t('questionnaire.preview.targetingNoMatch'))).toBeInTheDocument();
    expect(writes(calls)[0]!.body).toEqual({ locale: 'fr', facts: { age: 25 } });
  });

  it('rejects non-object preview facts', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<VersionPage questionId={Q_ID} versionId={V1_ID} />, baseHandlers());
    await user.click(await screen.findByRole('button', { name: t('questionnaire.workflow.preview') }));
    fireEvent.change(screen.getByLabelText(t('questionnaire.preview.facts')), { target: { value: '[1]' } });
    await user.click(screen.getByRole('button', { name: t('questionnaire.preview.run') }));
    expect(screen.getByText(t('validation.jsonObject'))).toBeInTheDocument();
    expect(writes(calls)).toHaveLength(0);
  });
});
