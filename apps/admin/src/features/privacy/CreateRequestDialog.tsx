'use client';

import { useState } from 'react';
import { useNotify } from '@/components/shell/notice';
import { FormDialog } from '@/components/ui/FormDialog';
import { SelectField, TextAreaField, TextField } from '@/components/ui/fields';
import { t } from '@/i18n';
import { DSAR_KINDS, dsarCreateSchema, type DsarKind } from '@/lib/api/modules/privacy';
import { useAdminApi } from '@/lib/auth/session';
import { useFormSubmit } from '@/lib/forms/useFormSubmit';
import { kindLabel } from './labels';

/** Logs a request received outside the app on behalf of a user (`POST admin/privacy/requests`). */
export function CreateRequestDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const api = useAdminApi();
  const notify = useNotify();
  const { busy, error, fieldErrors, submit } = useFormSubmit();
  const [userId, setUserId] = useState('');
  const [kind, setKind] = useState<DsarKind>('export');
  const [notes, setNotes] = useState('');

  async function save() {
    const ok = await submit(dsarCreateSchema, { userId: userId.trim(), kind, notes: notes.trim() || undefined }, async (d) => {
      await api.privacy.createRequest(d);
      notify(t('privacy.create.done'));
    });
    if (ok) {
      onCreated();
      onClose();
    }
  }

  return (
    <FormDialog title={t('privacy.create.title')} onClose={onClose} onSubmit={() => void save()} busy={busy} error={error} fieldErrors={fieldErrors} submitLabel={t('privacy.create.submit')}>
      <p className="muted">{t('privacy.create.intro')}</p>
      <TextField label={t('privacy.create.userId')} hint={t('privacy.create.userIdHint')} value={userId} onChange={setUserId} error={fieldErrors.userId} required spellCheck={false} autoComplete="off" data-autofocus />
      <SelectField label={t('privacy.create.kind')} value={kind} onChange={(v) => setKind(v as DsarKind)} error={fieldErrors.kind} options={DSAR_KINDS.map((k) => ({ value: k, label: kindLabel(k) }))} required />
      <TextAreaField label={t('privacy.create.notes')} hint={t('privacy.create.notesHint')} value={notes} onChange={setNotes} error={fieldErrors.notes} maxLength={2000} rows={3} />
    </FormDialog>
  );
}
