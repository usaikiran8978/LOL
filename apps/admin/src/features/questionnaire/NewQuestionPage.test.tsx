import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { t } from '@/i18n';
import { routerMock } from '@/test/setup';
import { apiError, field, json, renderSignedIn } from '@/test/utils';
import { NewQuestionPage } from './NewQuestionPage';
import { baseHandlers, CAT_ID, COMPAT_ID, detail, Q2_ID, Q_ID, V1_ID, writes } from './test-fixtures';

const handlers = (create: () => unknown = () => json(201, { questionId: Q_ID, versionId: V1_ID })) => ({
  ...baseHandlers(),
  [`GET /admin/questions/${Q2_ID}`]: () => detail({ id: Q2_ID, key: 'pets' }),
  'POST /admin/questions': create,
});

async function fillBasics(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText(new RegExp(`^${t('common.key')}`)), 'smoking');
  await user.selectOptions(field(t('questionnaire.list.category')), CAT_ID);
  await user.selectOptions(field(t('questionnaire.editor.answerType')), 'yes_no');
  await user.type(screen.getByLabelText(`${t('questionnaire.editor.text')} (en)`, { exact: false }), 'Do you smoke?');
  await user.click(screen.getByRole('button', { name: t('questionnaire.options.useYesNo') }));
}

describe('NewQuestionPage', () => {
  beforeEach(() => routerMock.push.mockClear());

  it('creates a question with options, scoring, targeting and a compatibility rule, then opens the draft', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<NewQuestionPage />, handlers());
    await fillBasics(user);
    expect(screen.queryByRole('button', { name: t('questionnaire.options.useYesNo') })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText(t('questionnaire.editor.compatCategory')), COMPAT_ID);
    await user.click(screen.getByLabelText(t('questionnaire.editor.allowDealbreaker')));
    await user.click(screen.getByLabelText(t('questionnaire.editor.isRequired')));

    await user.click(screen.getByLabelText(t('questionnaire.editor.targetingEnabled')));
    await user.type(screen.getByLabelText(t('predicate.field')), 'countryCode');
    await user.type(screen.getByLabelText(t('predicate.value')), 'IN');

    await user.click(screen.getByRole('button', { name: t('questionnaire.rules.add') }));
    const rule = screen.getByRole('listitem', { name: t('questionnaire.rules.ruleN', { n: 1 }) });
    await user.selectOptions(within(rule).getByLabelText(t('questionnaire.rules.sourceOption')), 'yes');
    await user.selectOptions(within(rule).getByLabelText(t('questionnaire.rules.targetQuestion'), { exact: false }), Q2_ID);
    await user.selectOptions(within(rule).getByLabelText(t('questionnaire.rules.ruleType')), 'dealbreaker');
    await waitFor(() => expect(within(rule).getByLabelText(t('questionnaire.rules.targetOption'))).toBeEnabled());
    await user.selectOptions(within(rule).getByLabelText(t('questionnaire.rules.targetOption')), 'tea');

    await user.click(screen.getByRole('button', { name: t('questionnaire.create.submit') }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]!.body).toMatchObject({
      key: 'smoking',
      categoryId: CAT_ID,
      version: {
        answerType: 'yes_no', isRequired: true, allowDealbreaker: true, compatibilityCategoryId: COMPAT_ID,
        translations: { en: { text: 'Do you smoke?' } },
        options: [{ key: 'yes', translations: { en: { label: t('common.yes') } } }, { key: 'no', translations: { en: { label: t('common.no') } } }],
        targeting: { all: [{ field: 'countryCode', op: 'eq', value: 'IN' }] },
        rules: [{ sourceOptionKey: 'yes', targetQuestionId: Q2_ID, targetOptionKey: 'tea', ruleType: 'dealbreaker', scoreDelta: 0, isBidirectional: true }],
      },
    });
    expect('position' in (writes(calls)[0]!.body as object)).toBe(false);
    await waitFor(() => expect(routerMock.push).toHaveBeenCalledWith(`/questionnaire/${Q_ID}/versions/${V1_ID}`));
  });

  it('blocks invalid input locally (key format, missing category, invalid targeting)', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<NewQuestionPage />, handlers());
    await user.type(await screen.findByLabelText(new RegExp(`^${t('common.key')}`)), 'Bad Key');
    await user.click(screen.getByLabelText(t('questionnaire.editor.targetingEnabled')));
    await user.click(screen.getByRole('button', { name: t('questionnaire.create.submit') }));
    expect(await screen.findByText(t('questionnaire.editor.targetingInvalid'))).toBeInTheDocument();
    expect(screen.getByText(t('validation.invalidFormat'))).toBeInTheDocument();
    expect(writes(calls)).toHaveLength(0);
  });

  it('shows server conflicts (duplicate key)', async () => {
    const user = userEvent.setup();
    await renderSignedIn(<NewQuestionPage />, handlers(() => apiError(409, 'CONFLICT')));
    await fillBasics(user);
    await user.click(screen.getByRole('button', { name: t('questionnaire.create.submit') }));
    expect(await screen.findByText(t('errors.CONFLICT'))).toBeInTheDocument();
    expect(routerMock.push).not.toHaveBeenCalled();
  });

  it('is forbidden without questions.edit', async () => {
    await renderSignedIn(<NewQuestionPage />, handlers(), ['questions.view']);
    expect(await screen.findByText(t('states.forbiddenTitle'))).toBeInTheDocument();
  });
});
