import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { t } from '@/i18n';
import { apiError, renderSignedIn } from '@/test/utils';
import { FeaturesPage } from './FeaturesPage';
import { aiWrites, FALLBACK_ID, featureConfig, MODEL_ID, prompts, providers } from './fixtures.test-data';

const base = {
  'GET /admin/ai/providers': () => providers(),
  'GET /admin/ai/prompts': () => prompts(),
};

describe('FeaturesPage', () => {
  it('lists every AI feature with its configuration or "not configured"', async () => {
    await renderSignedIn(<FeaturesPage />, { ...base, 'GET /admin/ai/features': () => [featureConfig()] });
    const row = (await screen.findByText(t('ai.featureNames.profile_coach'))).closest('tr')!;
    expect(within(row).getByText(t('ai.enabled'))).toBeInTheDocument();
    expect(within(row).getByText('openai / gpt-main')).toBeInTheDocument();
    expect(within(row).getByText('profile_coach', { selector: 'td code' })).toBeInTheDocument();
    expect(within(row).getByText(t('ai.features.limitsValue', { free: '2', premium: t('ai.features.unlimited') }))).toBeInTheDocument();
    expect(screen.getAllByText(t('ai.features.notConfigured'))).toHaveLength(11);
  });

  it('updates a configured feature after confirmation with the full contract body', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<FeaturesPage />, {
      ...base,
      'GET /admin/ai/features': () => [featureConfig()],
      'PUT /admin/ai/features/profile_coach': (c) => ({ ...featureConfig(), ...(c.body as object) }),
    });
    await user.click(await screen.findByRole('button', { name: `${t('common.edit')} ${t('ai.featureNames.profile_coach')}` }));
    const d = screen.getByRole('dialog');
    await user.selectOptions(within(d).getByLabelText(t('ai.features.fallbackModel')), FALLBACK_ID);
    const budget = within(d).getByLabelText(t('ai.features.monthlyBudgetUsd'));
    await user.clear(budget);
    await user.type(budget, '250');
    await user.type(within(d).getByLabelText(t('ai.features.premiumDailyLimit')), '20');
    await user.type(within(d).getByLabelText(t('ai.features.requiresEntitlement')), 'ai_coach_advanced');
    await user.click(within(d).getByRole('button', { name: t('common.save') }));

    const confirm = screen.getByRole('dialog', { name: t('ai.features.confirmTitle') });
    expect(aiWrites(calls)).toHaveLength(0);
    await user.click(within(confirm).getByRole('button', { name: t('ai.features.confirmAction') }));
    await waitFor(() => expect(aiWrites(calls)).toHaveLength(1));
    expect(aiWrites(calls)[0]!.method).toBe('PUT');
    expect(aiWrites(calls)[0]!.body).toEqual({
      isEnabled: true, primaryModelId: MODEL_ID, fallbackModelId: FALLBACK_ID, promptTemplateKey: 'profile_coach', temperature: null, maxInputTokens: 4000,
      maxOutputTokens: 800, perUserDailyLimit: 2, premiumDailyLimit: 20, requiresEntitlement: 'ai_coach_advanced', monthlyBudgetUsd: 250, moderateInput: true,
      moderateOutput: true, safetyThreshold: 0.5, runAsync: false, requiresConsent: 'ai_assistance',
    });
    expect(await screen.findByText(t('common.saved'))).toBeInTheDocument();
  });

  it('validates ranges client-side and shows server errors', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<FeaturesPage />, {
      ...base,
      'GET /admin/ai/features': () => [],
      'PUT /admin/ai/features/translation': () => apiError(400, 'VALIDATION_FAILED'),
    });
    await user.click(await screen.findByRole('button', { name: `${t('ai.features.configure')} ${t('ai.featureNames.translation')}` }));
    const d = screen.getByRole('dialog');
    // No template exists for "translation", so the required template is empty.
    await user.type(within(d).getByLabelText(t('ai.features.temperature')), '3');
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    expect(within(d).getByText(t('validation.required'))).toBeInTheDocument();
    expect(within(d).getByText(t('validation.tooBig', { max: 2 }))).toBeInTheDocument();
    expect(aiWrites(calls)).toHaveLength(0);

    const temp = within(d).getByLabelText(t('ai.features.temperature'));
    await user.clear(temp);
    await user.selectOptions(within(d).getByLabelText(t('ai.features.promptTemplate'), { exact: false }), 'profile_coach');
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    await user.click(within(screen.getByRole('dialog', { name: t('ai.features.confirmTitle') })).getByRole('button', { name: t('ai.features.confirmAction') }));
    await waitFor(() => expect(aiWrites(calls)).toHaveLength(1));
    expect(aiWrites(calls)[0]!.path).toBe('/admin/ai/features/translation');
    expect(aiWrites(calls)[0]!.body).toMatchObject({ isEnabled: false, primaryModelId: null, promptTemplateKey: 'profile_coach', requiresConsent: 'ai_assistance' });
    expect(await within(screen.getByRole('dialog')).findByText(t('errors.VALIDATION_FAILED'))).toBeInTheDocument();
  });

  it('hides edit actions without ai.manage', async () => {
    await renderSignedIn(<FeaturesPage />, { ...base, 'GET /admin/ai/features': () => [featureConfig()] }, ['ai.view']);
    expect(await screen.findByText(t('ai.featureNames.profile_coach'))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: new RegExp(t('common.edit')) })).toBeNull();
    expect(screen.queryByRole('button', { name: new RegExp(t('ai.features.configure')) })).toBeNull();
  });

  it('shows an error with retry', async () => {
    const user = userEvent.setup();
    let fail = true;
    await renderSignedIn(<FeaturesPage />, { ...base, 'GET /admin/ai/features': () => (fail ? apiError(500, 'INTERNAL') : []) });
    expect(await screen.findByText(t('states.errorTitle'))).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: t('common.retry') }));
    expect(await screen.findByText(t('ai.featureNames.scam_risk'))).toBeInTheDocument();
  });
});
