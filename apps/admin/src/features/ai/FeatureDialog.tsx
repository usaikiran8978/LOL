'use client';

import { adminAiFeatureConfig, type AiFeature } from '@amora/shared';
import { useState } from 'react';
import type { z } from 'zod';
import { useNotify } from '@/components/shell/notice';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { FormDialog } from '@/components/ui/FormDialog';
import { CheckboxField, NumberField, SelectField, TextField } from '@/components/ui/fields';
import { t } from '@/i18n';
import type { AiFeatureConfig, AiPromptTemplate } from '@/lib/api/modules/ai';
import { useAdminApi } from '@/lib/auth/session';
import { useFormSubmit } from '@/lib/forms/useFormSubmit';
import { validate } from '@/lib/forms/validate';
import { blankToNull, featureName, modelLabel, toNumber, type ModelRef } from './shared';

interface FeatureForm {
  isEnabled: boolean;
  primaryModelId: string;
  fallbackModelId: string;
  promptTemplateKey: string;
  temperature: number | undefined;
  maxInputTokens: number | undefined;
  maxOutputTokens: number | undefined;
  perUserDailyLimit: number | undefined;
  premiumDailyLimit: number | undefined;
  requiresEntitlement: string;
  monthlyBudgetUsd: number | undefined;
  moderateInput: boolean;
  moderateOutput: boolean;
  safetyThreshold: number | undefined;
  runAsync: boolean;
  requiresConsent: string;
}

const und = (v: string | number | null | undefined) => toNumber(v) ?? undefined;
const orNull = (n: number | undefined) => (n === undefined || Number.isNaN(n) ? null : n);

function toForm(feature: AiFeature, cfg: AiFeatureConfig | undefined, templates: AiPromptTemplate[]): FeatureForm {
  if (!cfg) {
    // Unconfigured: start from the contract defaults and the template built for this feature, if any.
    const tpl = templates.find((x) => x.feature_key === feature) ?? templates.find((x) => x.key === feature);
    return {
      isEnabled: false, primaryModelId: '', fallbackModelId: '', promptTemplateKey: tpl?.key ?? '', temperature: undefined, maxInputTokens: 4000, maxOutputTokens: 800,
      perUserDailyLimit: undefined, premiumDailyLimit: undefined, requiresEntitlement: '', monthlyBudgetUsd: undefined, moderateInput: true, moderateOutput: true,
      safetyThreshold: 0.5, runAsync: false, requiresConsent: 'ai_assistance',
    };
  }
  return {
    isEnabled: cfg.is_enabled, primaryModelId: cfg.primary_model_id ?? '', fallbackModelId: cfg.fallback_model_id ?? '',
    promptTemplateKey: templates.find((x) => x.id === cfg.prompt_template_id)?.key ?? '', temperature: und(cfg.temperature),
    maxInputTokens: cfg.max_input_tokens, maxOutputTokens: cfg.max_output_tokens, perUserDailyLimit: cfg.per_user_daily_limit ?? undefined,
    premiumDailyLimit: cfg.premium_daily_limit ?? undefined, requiresEntitlement: cfg.requires_entitlement ?? '', monthlyBudgetUsd: und(cfg.monthly_budget_usd),
    moderateInput: cfg.moderate_input, moderateOutput: cfg.moderate_output, safetyThreshold: und(cfg.safety_threshold), runAsync: cfg.run_async,
    requiresConsent: cfg.requires_consent ?? '',
  };
}

type Body = z.output<typeof adminAiFeatureConfig>;

export function FeatureDialog({ feature, config, models, templates, onClose, onSaved }: {
  feature: AiFeature; config: AiFeatureConfig | undefined; models: ModelRef[]; templates: AiPromptTemplate[]; onClose: () => void; onSaved: () => void;
}) {
  const api = useAdminApi();
  const notify = useNotify();
  const { busy, error, fieldErrors, setFieldErrors, send } = useFormSubmit();
  const [form, setForm] = useState<FeatureForm>(() => toForm(feature, config, templates));
  const [confirming, setConfirming] = useState<Body | null>(null);
  const set = <K extends keyof FeatureForm>(k: K) => (v: FeatureForm[K]) => setForm((s) => ({ ...s, [k]: v }));

  const modelOptions = models.map((m) => ({ value: m.model.id, label: modelLabel(m) }));
  const templateOptions = templates.map((x) => ({ value: x.key, label: x.feature_key === x.key ? x.key : `${x.key} (${featureName(x.feature_key)})` }));

  function review() {
    const v = validate(adminAiFeatureConfig, {
      isEnabled: form.isEnabled, primaryModelId: form.primaryModelId || null, fallbackModelId: form.fallbackModelId || null, promptTemplateKey: form.promptTemplateKey,
      temperature: orNull(form.temperature), maxInputTokens: form.maxInputTokens, maxOutputTokens: form.maxOutputTokens, perUserDailyLimit: orNull(form.perUserDailyLimit),
      premiumDailyLimit: orNull(form.premiumDailyLimit), requiresEntitlement: blankToNull(form.requiresEntitlement), monthlyBudgetUsd: orNull(form.monthlyBudgetUsd),
      moderateInput: form.moderateInput, moderateOutput: form.moderateOutput, safetyThreshold: form.safetyThreshold, runAsync: form.runAsync,
      requiresConsent: blankToNull(form.requiresConsent),
    });
    if (!v.ok) {
      return setFieldErrors(form.promptTemplateKey ? v.errors : { ...v.errors, promptTemplateKey: t('validation.required') });
    }
    setFieldErrors({});
    // Feature configuration is live for every user, so saves are confirmed.
    setConfirming(v.data);
  }

  async function apply(body: Body) {
    const ok = await send(() => api.ai.upsertFeature(feature, body));
    if (ok) {
      notify(t('common.saved'));
      onSaved();
      onClose();
    }
  }

  return (
    <>
      <FormDialog title={t('ai.features.editTitle', { feature: featureName(feature) })} onClose={onClose} onSubmit={review} busy={busy} error={error} fieldErrors={fieldErrors} size="lg">
        <CheckboxField label={t('ai.enabled')} checked={form.isEnabled} onChange={set('isEnabled')} />
        <fieldset className="stack">
          <legend className="card__title">{t('ai.features.sectionModels')}</legend>
          <div className="grid grid--2">
            <SelectField label={t('ai.features.primaryModel')} value={form.primaryModelId} onChange={set('primaryModelId')} options={modelOptions} placeholder={t('ai.features.noModel')} error={fieldErrors.primaryModelId} />
            <SelectField label={t('ai.features.fallbackModel')} value={form.fallbackModelId} onChange={set('fallbackModelId')} options={modelOptions} placeholder={t('ai.features.noModel')} error={fieldErrors.fallbackModelId} />
          </div>
          <SelectField
            label={t('ai.features.promptTemplate')}
            hint={templates.length ? t('ai.features.promptTemplateHint') : t('ai.features.noTemplates')}
            value={form.promptTemplateKey}
            onChange={set('promptTemplateKey')}
            options={templateOptions}
            placeholder=""
            error={fieldErrors.promptTemplateKey}
            required
          />
          <div className="grid grid--3">
            <NumberField label={t('ai.features.temperature')} hint={t('ai.features.temperatureHint')} value={form.temperature} onChange={set('temperature')} error={fieldErrors.temperature} min={0} max={2} step={0.05} />
            <NumberField label={t('ai.features.maxInputTokens')} value={form.maxInputTokens} onChange={set('maxInputTokens')} error={fieldErrors.maxInputTokens} min={100} max={200_000} step={1} required />
            <NumberField label={t('ai.features.maxOutputTokens')} value={form.maxOutputTokens} onChange={set('maxOutputTokens')} error={fieldErrors.maxOutputTokens} min={16} max={8000} step={1} required />
          </div>
        </fieldset>
        <fieldset className="stack">
          <legend className="card__title">{t('ai.features.sectionLimits')}</legend>
          <div className="grid grid--3">
            <NumberField label={t('ai.features.perUserDailyLimit')} hint={t('ai.features.limitHint')} value={form.perUserDailyLimit} onChange={set('perUserDailyLimit')} error={fieldErrors.perUserDailyLimit} min={0} step={1} />
            <NumberField label={t('ai.features.premiumDailyLimit')} hint={t('ai.features.limitHint')} value={form.premiumDailyLimit} onChange={set('premiumDailyLimit')} error={fieldErrors.premiumDailyLimit} min={0} step={1} />
            <NumberField label={t('ai.features.monthlyBudgetUsd')} hint={t('ai.features.monthlyBudgetHint')} value={form.monthlyBudgetUsd} onChange={set('monthlyBudgetUsd')} error={fieldErrors.monthlyBudgetUsd} min={0} step="any" />
          </div>
        </fieldset>
        <fieldset className="stack">
          <legend className="card__title">{t('ai.features.sectionSafety')}</legend>
          <div className="grid grid--2">
            <TextField label={t('ai.features.requiresEntitlement')} hint={t('ai.features.requiresEntitlementHint')} value={form.requiresEntitlement} onChange={set('requiresEntitlement')} error={fieldErrors.requiresEntitlement} maxLength={50} spellCheck={false} />
            <TextField label={t('ai.features.requiresConsent')} hint={t('ai.features.requiresConsentHint')} value={form.requiresConsent} onChange={set('requiresConsent')} error={fieldErrors.requiresConsent} maxLength={50} spellCheck={false} />
          </div>
          <NumberField label={t('ai.features.safetyThreshold')} hint={t('ai.features.safetyThresholdHint')} value={form.safetyThreshold} onChange={set('safetyThreshold')} error={fieldErrors.safetyThreshold} min={0} max={1} step={0.05} required />
          <CheckboxField label={t('ai.features.moderateInput')} checked={form.moderateInput} onChange={set('moderateInput')} />
          <CheckboxField label={t('ai.features.moderateOutput')} checked={form.moderateOutput} onChange={set('moderateOutput')} />
          <CheckboxField label={t('ai.features.runAsync')} checked={form.runAsync} onChange={set('runAsync')} />
        </fieldset>
      </FormDialog>
      {confirming ? (
        <ConfirmDialog
          title={t('ai.features.confirmTitle')}
          body={t('ai.features.confirmBody', { feature: featureName(feature) })}
          confirmLabel={t('ai.features.confirmAction')}
          onConfirm={() => apply(confirming)}
          onClose={() => setConfirming(null)}
        />
      ) : null}
    </>
  );
}
