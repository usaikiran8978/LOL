'use client';

import { adminCaseNote } from '@amora/shared';
import { useState } from 'react';
import { useNotify } from '@/components/shell/notice';
import { TextAreaField } from '@/components/ui/fields';
import { EmptyState, FormError } from '@/components/ui/states';
import { t } from '@/i18n';
import { errorMessage, requestIdOf } from '@/lib/api/errors';
import type { CaseNote } from '@/lib/api/modules/safety';
import { useAdminApi } from '@/lib/auth/session';
import { formatDateTime } from '@/lib/format';
import { useFormSubmit } from '@/lib/forms/useFormSubmit';

/** Internal case notes (`moderation.view` may add notes). */
export function CaseNotes({ caseId, notes, onAdded }: { caseId: string; notes: CaseNote[]; onAdded: () => void }) {
  const api = useAdminApi();
  const notify = useNotify();
  const { busy, error, fieldErrors, submit } = useFormSubmit();
  const [body, setBody] = useState('');

  async function add() {
    const ok = await submit(adminCaseNote, { body }, (data) => api.safety.addNote(caseId, data));
    if (ok) {
      setBody('');
      notify(t('safety.notes.added'));
      onAdded();
    }
  }

  return (
    <section className="section" aria-labelledby="case-notes">
      <h2 id="case-notes">{t('safety.notes.title', { count: notes.length })}</h2>
      {notes.length === 0 ? (
        <EmptyState message={t('safety.notes.empty')} />
      ) : (
        <ol className="stack safety-evidence">
          {notes.map((n) => (
            <li key={n.id} className="card">
              <p className="muted">{t('safety.notes.byline', { author: n.author ?? '—', at: formatDateTime(n.created_at) })}</p>
              <p className="pre-wrap">{n.body}</p>
            </li>
          ))}
        </ol>
      )}
      <form className="stack" noValidate onSubmit={(e) => { e.preventDefault(); void add(); }} aria-label={t('safety.notes.add')}>
        {error ? <FormError message={errorMessage(error)} requestId={requestIdOf(error)} /> : null}
        <TextAreaField label={t('safety.notes.body')} value={body} onChange={setBody} error={fieldErrors.body} rows={3} maxLength={5000} required />
        <div className="row">
          <button type="submit" className="btn btn--primary btn--md" disabled={busy}>{busy ? t('common.saving') : t('safety.notes.add')}</button>
        </div>
      </form>
    </section>
  );
}
