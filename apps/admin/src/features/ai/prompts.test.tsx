import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { t } from '@/i18n';
import { apiError, json, renderSignedIn } from '@/test/utils';
import { aiWrites, MODEL_ID, prompts, providers, VERSION_DRAFT, VERSION_PUB } from './fixtures.test-data';
import { PromptsPage } from './PromptsPage';

const base = {
  'GET /admin/ai/prompts': () => prompts(),
  'GET /admin/ai/providers': () => providers(),
};
const v = (n: number) => `profile_coach ${t('ai.prompts.versionLabel', { version: n })}`;

describe('PromptsPage', () => {
  it('lists versions and publishes a draft only after confirmation', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<PromptsPage />, {
      ...base,
      [`POST /admin/ai/prompts/versions/${VERSION_DRAFT}/publish`]: () => ({ id: VERSION_DRAFT, version: 2, status: 'published' }),
    });
    expect(await screen.findByText('Bio suggestions')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: new RegExp(`^${t('ai.prompts.publish')} `) })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: `${t('ai.prompts.publish')} ${v(2)}` }));
    const confirm = screen.getByRole('dialog', { name: t('ai.prompts.confirmPublishTitle', { key: 'profile_coach', version: 2 }) });
    expect(aiWrites(calls)).toHaveLength(0);
    await user.click(within(confirm).getByRole('button', { name: t('ai.prompts.confirmPublishAction') }));
    await waitFor(() => expect(aiWrites(calls)).toHaveLength(1));
    expect(aiWrites(calls)[0]!.path).toBe(`/admin/ai/prompts/versions/${VERSION_DRAFT}/publish`);
    expect(await screen.findByText(t('ai.prompts.published_ok', { version: 2 }))).toBeInTheDocument();
  });

  it('shows a version read-only', async () => {
    const user = userEvent.setup();
    await renderSignedIn(<PromptsPage />, base);
    await user.click(await screen.findByRole('button', { name: `${t('ai.prompts.view')} ${v(1)}` }));
    const d = screen.getByRole('dialog', { name: t('ai.prompts.viewTitle', { key: 'profile_coach', version: 1 }) });
    expect(within(d).getByText('Score the bio only.')).toBeInTheDocument();
    expect(within(d).getByText('Bio: {{bio}}')).toBeInTheDocument();
  });

  it('validates a new version locally, shows API schema errors, then creates it', async () => {
    const user = userEvent.setup();
    let reply: Response | object = json(400, { error: { code: 'VALIDATION_FAILED', message: 'Invalid output JSON Schema: schema is invalid: data/type must be equal to one of the allowed values', requestId: 'req-9' } });
    const { calls } = await renderSignedIn(<PromptsPage />, {
      ...base,
      'POST /admin/ai/prompts/profile_coach/versions': () => reply,
    });
    await user.click(await screen.findByRole('button', { name: t('ai.prompts.newVersionFor', { key: 'profile_coach' }) }));
    const d = screen.getByRole('dialog');
    expect(within(d).getByText(t('ai.prompts.basedOn', { version: 2 }))).toBeInTheDocument();
    const tpl = within(d).getByLabelText(t('ai.prompts.userTemplate'), { exact: false });
    expect(tpl).toHaveValue('Bio: {{bio}} Tone: {{tone}}');

    fireEvent.change(tpl, { target: { value: 'Bio: {{bio}} {{oops}}' } });
    fireEvent.change(within(d).getByLabelText(t('ai.prompts.outputSchema'), { exact: false }), { target: { value: '{bad' } });
    fireEvent.change(within(d).getByLabelText(t('ai.prompts.inputVariables')), { target: { value: 'bio, 9bad' } });
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    expect(within(d).getByText(t('ai.prompts.undeclared', { names: 'oops' }))).toBeInTheDocument();
    expect(within(d).getByText(t('validation.invalidJson'))).toBeInTheDocument();
    expect(within(d).getByText(t('ai.prompts.invalidVariable', { name: '9bad' }))).toBeInTheDocument();
    expect(aiWrites(calls)).toHaveLength(0);

    fireEvent.change(tpl, { target: { value: 'Bio: {{bio}}' } });
    fireEvent.change(within(d).getByLabelText(t('ai.prompts.outputSchema'), { exact: false }), { target: { value: '{"type":"nonsense"}' } });
    fireEvent.change(within(d).getByLabelText(t('ai.prompts.inputVariables')), { target: { value: 'bio' } });
    await user.type(within(d).getByLabelText(t('ai.prompts.changeNote')), 'Simplify');
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    await waitFor(() => expect(aiWrites(calls)).toHaveLength(1));
    expect(aiWrites(calls)[0]!.body).toEqual({
      systemPrompt: 'Score the bio only, be brief.', userTemplate: 'Bio: {{bio}}', outputSchema: { type: 'nonsense' }, inputVariables: ['bio'],
      temperature: 0.4, maxOutputTokens: 400, changeNote: 'Simplify',
    });
    expect(await within(d).findByText(t('ai.prompts.serverDetail'))).toBeInTheDocument();
    expect(within(d).getByText(/Invalid output JSON Schema/)).toBeInTheDocument();

    reply = { id: 'new', version: 3, status: 'draft' };
    fireEvent.change(within(d).getByLabelText(t('ai.prompts.outputSchema'), { exact: false }), { target: { value: '{"type":"object"}' } });
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    expect(await screen.findByText(t('ai.prompts.created_ok', { version: 3 }))).toBeInTheDocument();
    expect(aiWrites(calls)[1]!.body).toMatchObject({ outputSchema: { type: 'object' } });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('test-runs a version with sample variables and shows the result', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<PromptsPage />, {
      ...base,
      [`POST /admin/ai/prompts/versions/${VERSION_DRAFT}/test`]: () => ({ output: { score: 50, suggestions: ['Add a hobby'] }, requestId: 'r-1', model: 'gpt-main', usedFallback: false }),
    });
    await user.click(await screen.findByRole('button', { name: `${t('ai.prompts.test')} ${v(2)}` }));
    const d = screen.getByRole('dialog');
    await user.type(within(d).getByLabelText(t('ai.test.variableLabel', { name: 'bio' })), 'I like hiking');
    await user.selectOptions(within(d).getByLabelText(t('ai.test.model')), MODEL_ID);
    await user.click(within(d).getByRole('button', { name: t('ai.test.run') }));
    expect(await within(d).findByText(/Add a hobby/)).toBeInTheDocument();
    expect(within(d).getByText('gpt-main')).toBeInTheDocument();
    expect(within(d).getByText('r-1')).toBeInTheDocument();
    expect(aiWrites(calls)[0]!.body).toEqual({ variables: { bio: 'I like hiking', tone: '' }, modelId: MODEL_ID });
  });

  it.each([
    ['AI_NOT_CONFIGURED', 'ai.test.notConfiguredHint'],
    ['AI_UNAVAILABLE', 'ai.test.unavailableHint'],
    ['AI_BUDGET_EXCEEDED', 'ai.test.budgetHint'],
  ] as const)('explains %s on a test run', async (code, hint) => {
    const user = userEvent.setup();
    await renderSignedIn(<PromptsPage />, { ...base, [`POST /admin/ai/prompts/versions/${VERSION_PUB}/test`]: () => apiError(code === 'AI_BUDGET_EXCEEDED' ? 429 : 503, code) });
    await user.click(await screen.findByRole('button', { name: `${t('ai.prompts.test')} ${v(1)}` }));
    const d = screen.getByRole('dialog');
    await user.click(within(d).getByRole('button', { name: t('ai.test.run') }));
    expect(await within(d).findByText(t(`errors.${code}`))).toBeInTheDocument();
    expect(within(d).getByText(t(hint))).toBeInTheDocument();
  });

  it('gates actions by prompt permissions', async () => {
    const view = await renderSignedIn(<PromptsPage />, base, ['ai.view']);
    expect(await screen.findByText('Bio suggestions')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('ai.prompts.newVersionFor', { key: 'profile_coach' }) })).toBeNull();
    expect(screen.queryByRole('button', { name: `${t('ai.prompts.test')} ${v(2)}` })).toBeNull();
    expect(screen.queryByRole('button', { name: `${t('ai.prompts.publish')} ${v(2)}` })).toBeNull();
    expect(screen.getByRole('button', { name: `${t('ai.prompts.view')} ${v(2)}` })).toBeInTheDocument();
    view.unmount();

    await renderSignedIn(<PromptsPage />, base, ['ai.view', 'ai.prompts.edit']);
    expect(await screen.findByRole('button', { name: `${t('ai.prompts.test')} ${v(2)}` })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('ai.prompts.newVersionFor', { key: 'profile_coach' }) })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: `${t('ai.prompts.publish')} ${v(2)}` })).toBeNull();
  });

  it('shows empty and error states', async () => {
    const user = userEvent.setup();
    let fail = true;
    await renderSignedIn(<PromptsPage />, { 'GET /admin/ai/prompts': () => (fail ? apiError(500, 'INTERNAL') : []), 'GET /admin/ai/providers': () => [] });
    expect(await screen.findByText(t('states.errorTitle'))).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: t('common.retry') }));
    expect(await screen.findByText(t('ai.prompts.empty'))).toBeInTheDocument();
  });
});
