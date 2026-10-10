'use client';

import { adminAiModelUpsert } from '@amora/shared';
import { useState } from 'react';
import { useNotify } from '@/components/shell/notice';
import { FormDialog } from '@/components/ui/FormDialog';
import { CheckboxField, NumberField, ReadOnlyField, SelectField, TextField } from '@/components/ui/fields';
import { t } from '@/i18n';
import type { AiModel, AiModelPurpose, AiProvider } from '@/lib/api/modules/ai';
import { useAdminApi } from '@/lib/auth/session';
import { useFormSubmit } from '@/lib/forms/useFormSubmit';
import { purposeLabel, toNumber } from './shared';

const PURPOSES = adminAiModelUpsert.shape.purpose.options;

interface ModelForm {
  modelName: string;
  purpose: AiModelPurpose;
  contextTokens: number | undefined;
  inputCostPerMtok: number | undefined;
  outputCostPerMtok: number | undefined;
  isEnabled: boolean;
}

const orNull = (n: number | undefined) => (n === undefined || Number.isNaN(n) ? null : n);

/** Registers a model on a provider, or updates it (POST admin/ai/models upserts on provider + model name). */
export function ModelDialog({ provider, model, onClose, onSaved }: { provider: AiProvider; model: AiModel | null; onClose: () => void; onSaved: () => void }) {
  const api = useAdminApi();
  const notify = useNotify();
  const { busy, error, fieldErrors, submit } = useFormSubmit();
  const [form, setForm] = useState<ModelForm>(() =>
    model
      ? {
        modelName: model.model_name, purpose: model.purpose, contextTokens: model.context_tokens ?? undefined,
        inputCostPerMtok: toNumber(model.input_cost_per_mtok) ?? undefined, outputCostPerMtok: toNumber(model.output_cost_per_mtok) ?? undefined, isEnabled: model.is_enabled,
      }
      : { modelName: '', purpose: 'chat', contextTokens: undefined, inputCostPerMtok: undefined, outputCostPerMtok: undefined, isEnabled: true },
  );
  const set = <K extends keyof ModelForm>(k: K) => (v: ModelForm[K]) => setForm((s) => ({ ...s, [k]: v }));

  async function save() {
    const value = {
      providerKey: provider.key, modelName: form.modelName.trim(), purpose: form.purpose, contextTokens: orNull(form.contextTokens),
      inputCostPerMtok: orNull(form.inputCostPerMtok), outputCostPerMtok: orNull(form.outputCostPerMtok), isEnabled: form.isEnabled,
    };
    const ok = await submit(adminAiModelUpsert, value, (body) => api.ai.upsertModel(body));
    if (ok) {
      notify(t('common.saved'));
      onSaved();
      onClose();
    }
  }

  return (
    <FormDialog
      title={model ? t('ai.models.editModel', { name: model.model_name }) : t('ai.models.newModel', { provider: provider.key })}
      onClose={onClose}
      onSubmit={() => void save()}
      busy={busy}
      error={error}
      fieldErrors={fieldErrors}
    >
      <ReadOnlyField label={t('ai.models.provider')} value={provider.key} />
      {model ? (
        <ReadOnlyField label={t('ai.models.modelName')} value={model.model_name} hint={t('common.immutableHint')} />
      ) : (
        <TextField label={t('ai.models.modelName')} hint={t('ai.models.modelNameHint')} value={form.modelName} onChange={set('modelName')} error={fieldErrors.modelName} required data-autofocus spellCheck={false} autoComplete="off" />
      )}
      <SelectField label={t('ai.models.purpose')} value={form.purpose} onChange={(v) => set('purpose')(v as AiModelPurpose)} options={PURPOSES.map((p) => ({ value: p, label: purposeLabel(p) }))} error={fieldErrors.purpose} required />
      <NumberField label={t('ai.models.contextTokens')} value={form.contextTokens} onChange={set('contextTokens')} error={fieldErrors.contextTokens} min={1} step={1} />
      <div className="grid grid--2">
        <NumberField label={t('ai.models.inputCost')} value={form.inputCostPerMtok} onChange={set('inputCostPerMtok')} error={fieldErrors.inputCostPerMtok} min={0} step="any" />
        <NumberField label={t('ai.models.outputCost')} value={form.outputCostPerMtok} onChange={set('outputCostPerMtok')} error={fieldErrors.outputCostPerMtok} min={0} step="any" />
      </div>
      <CheckboxField label={t('ai.models.isEnabled')} checked={form.isEnabled} onChange={set('isEnabled')} />
    </FormDialog>
  );
}
