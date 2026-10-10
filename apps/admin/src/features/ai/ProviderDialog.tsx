'use client';

import { adminAiProviderUpsert } from '@amora/shared';
import { useState } from 'react';
import type { z } from 'zod';
import { useNotify } from '@/components/shell/notice';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { FormDialog } from '@/components/ui/FormDialog';
import { CheckboxField, NumberField, ReadOnlyField, SelectField, TextField } from '@/components/ui/fields';
import { t } from '@/i18n';
import type { AiProvider, AiProviderKind } from '@/lib/api/modules/ai';
import { useAdminApi } from '@/lib/auth/session';
import { useFormSubmit } from '@/lib/forms/useFormSubmit';
import { validate, type FieldErrors } from '@/lib/forms/validate';
import { blankToNull, kindLabel } from './shared';

const KINDS = adminAiProviderUpsert.shape.kind.options;
const KEY_RE = /^[a-z0-9_]{2,64}$/;

interface ProviderForm {
  key: string;
  kind: AiProviderKind;
  baseUrl: string;
  secretRef: string;
  isEnabled: boolean;
  timeoutMs: number | undefined;
}

const toForm = (p: AiProvider | null): ProviderForm =>
  p
    ? { key: p.key, kind: p.kind, baseUrl: p.base_url ?? '', secretRef: p.secret_ref, isEnabled: p.is_enabled, timeoutMs: p.timeout_ms }
    : { key: '', kind: 'openai_compatible', baseUrl: '', secretRef: '', isEnabled: false, timeoutMs: 30_000 };

type Body = z.output<typeof adminAiProviderUpsert>;

/**
 * Create/edit a provider. Only the *name* of the secret is sent (`secretRef`); the API key itself is provisioned in
 * the server environment and is never accepted, displayed or echoed by the console.
 */
export function ProviderDialog({ provider, onClose, onSaved }: { provider: AiProvider | null; onClose: () => void; onSaved: () => void }) {
  const api = useAdminApi();
  const notify = useNotify();
  const { busy, error, fieldErrors, setFieldErrors, send } = useFormSubmit();
  const [form, setForm] = useState<ProviderForm>(() => toForm(provider));
  const [confirming, setConfirming] = useState<{ key: string; body: Body } | null>(null);
  const set = <K extends keyof ProviderForm>(k: K) => (v: ProviderForm[K]) => setForm((s) => ({ ...s, [k]: v }));

  function review() {
    const v = validate(adminAiProviderUpsert, {
      kind: form.kind, baseUrl: blankToNull(form.baseUrl), secretRef: form.secretRef.trim(), isEnabled: form.isEnabled, timeoutMs: form.timeoutMs,
    });
    const errors: FieldErrors = v.ok ? {} : { ...v.errors };
    if (errors.secretRef) errors.secretRef = t('ai.providers.secretRefInvalid');
    const key = provider ? provider.key : form.key.trim();
    if (!provider && !KEY_RE.test(key)) errors.key = form.key.trim() ? t('validation.invalidFormat') : t('validation.required');
    if (!v.ok || Object.keys(errors).length) return setFieldErrors(errors);
    setFieldErrors({});
    // Provider changes affect live AI traffic immediately, so every save is confirmed.
    setConfirming({ key, body: v.data });
  }

  async function apply({ key, body }: { key: string; body: Body }) {
    const ok = await send(() => api.ai.upsertProvider(key, body));
    if (ok) {
      notify(t('common.saved'));
      onSaved();
      onClose();
    }
  }

  return (
    <>
      <FormDialog
        title={provider ? t('ai.providers.editProvider', { key: provider.key }) : t('ai.providers.newProvider')}
        onClose={onClose}
        onSubmit={review}
        busy={busy}
        error={error}
        fieldErrors={fieldErrors}
      >
        {provider ? (
          <ReadOnlyField label={t('ai.providers.key')} value={provider.key} hint={t('common.immutableHint')} />
        ) : (
          <TextField label={t('ai.providers.key')} hint={t('ai.providers.keyHint')} value={form.key} onChange={set('key')} error={fieldErrors.key} required data-autofocus spellCheck={false} autoComplete="off" />
        )}
        <SelectField label={t('ai.providers.kind')} value={form.kind} onChange={(v) => set('kind')(v as AiProviderKind)} options={KINDS.map((k) => ({ value: k, label: kindLabel(k) }))} error={fieldErrors.kind} required />
        <TextField label={t('ai.providers.baseUrl')} hint={t('ai.providers.baseUrlHint')} value={form.baseUrl} onChange={set('baseUrl')} error={fieldErrors.baseUrl} spellCheck={false} autoComplete="off" inputMode="url" />
        <TextField label={t('ai.providers.secretRef')} hint={t('ai.providers.secretRefHint')} value={form.secretRef} onChange={set('secretRef')} error={fieldErrors.secretRef} required spellCheck={false} autoComplete="off" />
        {provider ? <p className="muted">{t('ai.providers.secretNote')}</p> : null}
        <NumberField label={t('ai.providers.timeoutMs')} value={form.timeoutMs} onChange={set('timeoutMs')} error={fieldErrors.timeoutMs} min={1000} max={120_000} step={1000} required />
        <CheckboxField label={t('ai.providers.isEnabled')} hint={t('ai.providers.isEnabledHint')} checked={form.isEnabled} onChange={set('isEnabled')} />
      </FormDialog>
      {confirming ? (
        <ConfirmDialog
          title={t('ai.providers.confirmTitle')}
          body={t('ai.providers.confirmBody')}
          confirmLabel={t('ai.providers.confirmAction')}
          onConfirm={() => apply(confirming)}
          onClose={() => setConfirming(null)}
        />
      ) : null}
    </>
  );
}
