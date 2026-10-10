'use client';

import { adminCaseCreate } from '@amora/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useNotify } from '@/components/shell/notice';
import { FormDialog } from '@/components/ui/FormDialog';
import { SelectField, TextAreaField, TextField } from '@/components/ui/fields';
import { t } from '@/i18n';
import { CASE_CATEGORIES, SEVERITIES } from '@/lib/api/modules/safety';
import { useAdminApi } from '@/lib/auth/session';
import { useFormSubmit } from '@/lib/forms/useFormSubmit';
import { enumOptions } from './labels';

/** Opens a case manually (`moderation.action`). The API attaches to the subject's open case of the same category. */
export function CreateCaseDialog({ onClose }: { onClose: () => void }) {
  const api = useAdminApi();
  const notify = useNotify();
  const router = useRouter();
  const { busy, error, fieldErrors, submit } = useFormSubmit();
  const [form, setForm] = useState({ subjectUserId: '', category: '', severity: 'medium', note: '' });
  const set = (k: keyof typeof form) => (v: string) => setForm((s) => ({ ...s, [k]: v }));

  async function save() {
    const value = { subjectUserId: form.subjectUserId.trim(), category: form.category || undefined, severity: form.severity, note: form.note.trim() || undefined };
    await submit(adminCaseCreate, value, async (data) => {
      const res = await api.safety.createCase(data);
      notify(t('safety.create.created'));
      onClose();
      router.push(`/moderation/cases/${res.caseId}`);
    });
  }

  return (
    <FormDialog title={t('safety.create.title')} onClose={onClose} onSubmit={() => void save()} busy={busy} error={error} fieldErrors={fieldErrors} submitLabel={t('safety.create.submit')}>
      <p className="muted">{t('safety.create.intro')}</p>
      <TextField label={t('safety.create.subjectUserId')} value={form.subjectUserId} onChange={set('subjectUserId')} error={fieldErrors.subjectUserId} required data-autofocus spellCheck={false} />
      <SelectField label={t('safety.create.category')} value={form.category} onChange={set('category')} error={fieldErrors.category} placeholder={t('safety.create.choose')} options={enumOptions('category', CASE_CATEGORIES)} required />
      <SelectField label={t('safety.create.severity')} value={form.severity} onChange={set('severity')} error={fieldErrors.severity} options={enumOptions('severity', SEVERITIES)} required />
      <TextAreaField label={t('safety.create.note')} value={form.note} onChange={set('note')} error={fieldErrors.note} rows={3} maxLength={5000} />
    </FormDialog>
  );
}
