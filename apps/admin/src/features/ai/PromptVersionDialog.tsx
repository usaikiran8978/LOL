'use client';

import { useState } from 'react';
import { useNotify } from '@/components/shell/notice';
import { FormDialog } from '@/components/ui/FormDialog';
import { NumberField, TextAreaField } from '@/components/ui/fields';
import { t } from '@/i18n';
import { ApiError } from '@/lib/api/client';
import type { AiPromptTemplate } from '@/lib/api/modules/ai';
import { useAdminApi } from '@/lib/auth/session';
import { useFormSubmit } from '@/lib/forms/useFormSubmit';
import { promptFormFrom, validatePromptForm, type PromptForm } from './promptForm';

/**
 * The API reports schema-compile and undeclared-variable problems as VALIDATION_FAILED with a technical message
 * and no field details; prompt editors need that text to fix the schema, so it is shown verbatim as a detail.
 */
function serverDetail(error: unknown): string | null {
  if (!(error instanceof ApiError) || error.code !== 'VALIDATION_FAILED') return null;
  if (Array.isArray(error.details) && error.details.length) return null;
  return error.message || null;
}

/** Drafts a new version (POST admin/ai/prompts/:key/versions); pre-filled from the newest existing version. */
export function PromptVersionDialog({ template, onClose, onSaved }: { template: AiPromptTemplate; onClose: () => void; onSaved: () => void }) {
  const api = useAdminApi();
  const notify = useNotify();
  const base = template.versions[0];
  const { busy, error, fieldErrors, setFieldErrors, send } = useFormSubmit();
  const [form, setForm] = useState<PromptForm>(() => promptFormFrom(base));
  const set = <K extends keyof PromptForm>(k: K) => (v: PromptForm[K]) => setForm((s) => ({ ...s, [k]: v }));
  const detail = serverDetail(error);

  async function save() {
    const v = validatePromptForm(form);
    if (!v.ok) return setFieldErrors(v.errors);
    setFieldErrors({});
    let version = 0;
    const ok = await send(async () => {
      version = (await api.ai.createPromptVersion(template.key, v.data)).version;
    });
    if (ok) {
      notify(t('ai.prompts.created_ok', { version }));
      onSaved();
      onClose();
    }
  }

  return (
    <FormDialog title={t('ai.prompts.newVersionTitle', { key: template.key })} onClose={onClose} onSubmit={() => void save()} busy={busy} error={error} fieldErrors={fieldErrors} size="lg">
      {detail ? (
        <div className="alert alert--error">
          <p>{t('ai.prompts.serverDetail')}</p>
          <pre className="pre-wrap"><code>{detail}</code></pre>
        </div>
      ) : null}
      {base ? <p className="muted">{t('ai.prompts.basedOn', { version: base.version })}</p> : null}
      <TextAreaField label={t('ai.prompts.systemPrompt')} hint={t('ai.prompts.systemPromptHint')} value={form.systemPrompt} onChange={set('systemPrompt')} error={fieldErrors.systemPrompt} rows={6} maxLength={20000} required data-autofocus />
      <TextAreaField label={t('ai.prompts.userTemplate')} hint={t('ai.prompts.userTemplateHint')} value={form.userTemplate} onChange={set('userTemplate')} error={fieldErrors.userTemplate} rows={5} maxLength={20000} required spellCheck={false} />
      <TextAreaField label={t('ai.prompts.inputVariables')} hint={t('ai.prompts.inputVariablesHint')} value={form.inputVariables} onChange={set('inputVariables')} error={fieldErrors.inputVariables} rows={2} spellCheck={false} />
      <TextAreaField label={t('ai.prompts.outputSchema')} hint={t('ai.prompts.outputSchemaHint')} value={form.outputSchema} onChange={set('outputSchema')} error={fieldErrors.outputSchema} rows={8} spellCheck={false} className="code-input" required />
      <div className="grid grid--2">
        <NumberField label={t('ai.prompts.temperature')} hint={t('ai.prompts.temperatureHint')} value={form.temperature} onChange={set('temperature')} error={fieldErrors.temperature} min={0} max={2} step={0.05} />
        <NumberField label={t('ai.prompts.maxOutputTokens')} hint={t('ai.prompts.maxOutputTokensHint')} value={form.maxOutputTokens} onChange={set('maxOutputTokens')} error={fieldErrors.maxOutputTokens} min={16} max={8000} step={1} />
      </div>
      <TextAreaField label={t('ai.prompts.changeNote')} hint={t('ai.prompts.changeNoteHint')} value={form.changeNote} onChange={set('changeNote')} error={fieldErrors.changeNote} rows={2} maxLength={1000} />
    </FormDialog>
  );
}
