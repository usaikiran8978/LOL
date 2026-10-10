import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { t } from '@/i18n';
import { apiError, field, renderSignedIn } from '@/test/utils';
import { aiWrites, LEAKED_SECRET, MODEL_ID, providers } from './fixtures.test-data';
import { ProvidersPage } from './ProvidersPage';

describe('ProvidersPage', () => {
  it('shows providers with secret presence badges and models, never any secret value', async () => {
    // Even if the API ever leaked a key-like field, the page renders only whitelisted columns.
    const leaky = providers().map((p) => ({ ...p, api_key: LEAKED_SECRET, secret: LEAKED_SECRET }));
    const { container } = await renderSignedIn(<ProvidersPage />, { 'GET /admin/ai/providers': () => leaky });
    expect(await screen.findByText('OPENAI_API_KEY')).toBeInTheDocument();
    expect(screen.getByText(t('ai.providers.secretPresent'))).toBeInTheDocument();
    expect(screen.getByText(t('ai.providers.secretMissing'))).toBeInTheDocument();
    expect(screen.getByText('gpt-main')).toBeInTheDocument();
    expect(container.innerHTML).not.toContain(LEAKED_SECRET);

    await userEvent.setup().click(screen.getByRole('button', { name: `${t('common.edit')} openai` }));
    const d = screen.getByRole('dialog');
    expect(d.innerHTML).not.toContain(LEAKED_SECRET);
    expect(within(d).queryByDisplayValue(LEAKED_SECRET)).toBeNull();
    expect(d.querySelector('input[type="password"]')).toBeNull();
  });

  it('creates a provider after confirmation with the secret name only', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<ProvidersPage />, {
      'GET /admin/ai/providers': () => [],
      'PUT /admin/ai/providers/my_llm': (c) => ({ id: 'p9', key: 'my_llm', ...(c.body as object) }),
    });
    expect(await screen.findByText(t('ai.providers.empty'))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('ai.providers.newProvider') }));
    const d = screen.getByRole('dialog');
    await user.type(within(d).getByLabelText(t('ai.providers.key'), { exact: false }), 'My LLM');
    await user.type(within(d).getByLabelText(t('ai.providers.secretRef'), { exact: false }), 'sk-abc');
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    expect(within(d).getByText(t('validation.invalidFormat'))).toBeInTheDocument();
    expect(within(d).getByText(t('ai.providers.secretRefInvalid'))).toBeInTheDocument();
    expect(aiWrites(calls)).toHaveLength(0);

    const key = within(d).getByLabelText(t('ai.providers.key'), { exact: false });
    await user.clear(key);
    await user.type(key, 'my_llm');
    const secret = within(d).getByLabelText(t('ai.providers.secretRef'), { exact: false });
    await user.clear(secret);
    await user.type(secret, 'MY_LLM_KEY');
    await user.selectOptions(within(d).getByLabelText(t('ai.providers.kind'), { exact: false }), 'anthropic');
    await user.type(within(d).getByLabelText(t('ai.providers.baseUrl')), 'https://llm.example.com/v1');
    await user.click(within(d).getByLabelText(t('ai.providers.isEnabled')));
    await user.click(within(d).getByRole('button', { name: t('common.save') }));

    const confirm = screen.getByRole('dialog', { name: t('ai.providers.confirmTitle') });
    expect(aiWrites(calls)).toHaveLength(0);
    await user.click(within(confirm).getByRole('button', { name: t('ai.providers.confirmAction') }));
    await waitFor(() => expect(aiWrites(calls)).toHaveLength(1));
    expect(aiWrites(calls)[0]!.path).toBe('/admin/ai/providers/my_llm');
    expect(aiWrites(calls)[0]!.body).toEqual({ kind: 'anthropic', baseUrl: 'https://llm.example.com/v1', secretRef: 'MY_LLM_KEY', isEnabled: true, timeoutMs: 30000 });
    expect(await screen.findByText(t('common.saved'))).toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'GET' && c.path === '/admin/ai/providers')).toHaveLength(2);
  });

  it('edits an existing provider and keeps its key immutable', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<ProvidersPage />, {
      'GET /admin/ai/providers': () => providers(),
      'PUT /admin/ai/providers/claude': (c) => c.body,
    });
    await user.click(await screen.findByRole('button', { name: `${t('common.edit')} claude` }));
    const d = screen.getByRole('dialog');
    expect(field(t('ai.providers.key'))).toHaveAttribute('readonly');
    expect(within(d).getByLabelText(t('ai.providers.secretRef'), { exact: false })).toHaveValue('ANTHROPIC_API_KEY');
    await user.click(within(d).getByLabelText(t('ai.providers.isEnabled')));
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    await user.click(within(screen.getByRole('dialog', { name: t('ai.providers.confirmTitle') })).getByRole('button', { name: t('ai.providers.confirmAction') }));
    await waitFor(() => expect(aiWrites(calls)).toHaveLength(1));
    expect(aiWrites(calls)[0]!.body).toEqual({ kind: 'anthropic', baseUrl: 'https://api.anthropic.com', secretRef: 'ANTHROPIC_API_KEY', isEnabled: true, timeoutMs: 60000 });
  });

  it('adds and edits models via POST models', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<ProvidersPage />, {
      'GET /admin/ai/providers': () => providers(),
      'POST /admin/ai/models': (c) => ({ id: MODEL_ID, ...(c.body as object) }),
    });
    await user.click(await screen.findByRole('button', { name: `${t('ai.providers.addModel')} claude` }));
    let d = screen.getByRole('dialog');
    await user.type(within(d).getByLabelText(t('ai.models.modelName'), { exact: false }), 'claude-x');
    await user.selectOptions(within(d).getByLabelText(t('ai.models.purpose'), { exact: false }), 'moderation');
    await user.type(within(d).getByLabelText(t('ai.models.inputCost')), '3');
    await user.type(within(d).getByLabelText(t('ai.models.outputCost')), '15');
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    await waitFor(() => expect(aiWrites(calls)).toHaveLength(1));
    expect(aiWrites(calls)[0]!.body).toEqual({ providerKey: 'claude', modelName: 'claude-x', purpose: 'moderation', contextTokens: null, inputCostPerMtok: 3, outputCostPerMtok: 15, isEnabled: true });

    await user.click(await screen.findByRole('button', { name: `${t('common.edit')} openai / gpt-main` }));
    d = screen.getByRole('dialog');
    await user.click(within(d).getByLabelText(t('ai.models.isEnabled')));
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    await waitFor(() => expect(aiWrites(calls)).toHaveLength(2));
    expect(aiWrites(calls)[1]!.body).toEqual({ providerKey: 'openai', modelName: 'gpt-main', purpose: 'chat', contextTokens: 128000, inputCostPerMtok: 1.25, outputCostPerMtok: 5, isEnabled: false });
  });

  it('hides management actions without ai.manage', async () => {
    await renderSignedIn(<ProvidersPage />, { 'GET /admin/ai/providers': () => providers() }, ['ai.view']);
    expect(await screen.findByText('OPENAI_API_KEY')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('ai.providers.newProvider') })).toBeNull();
    expect(screen.queryByRole('button', { name: `${t('common.edit')} openai` })).toBeNull();
    expect(screen.queryByRole('button', { name: `${t('ai.providers.addModel')} openai` })).toBeNull();
  });

  it('shows an error with retry', async () => {
    const user = userEvent.setup();
    let fail = true;
    await renderSignedIn(<ProvidersPage />, { 'GET /admin/ai/providers': () => (fail ? apiError(500, 'INTERNAL') : providers()) });
    expect(await screen.findByText(t('states.errorTitle'))).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: t('common.retry') }));
    expect(await screen.findByText('OPENAI_API_KEY')).toBeInTheDocument();
  });

  it('shows a loading state first', async () => {
    await renderSignedIn(<ProvidersPage />, { 'GET /admin/ai/providers': () => new Promise(() => undefined) });
    expect(screen.getByText(t('app.loading'))).toBeInTheDocument();
  });
});
