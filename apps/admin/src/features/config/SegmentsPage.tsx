'use client';

import { adminSegmentUpsert } from '@amora/shared';
import { useState } from 'react';
import { PredicateBuilder, conversionMessage } from '@/components/editors/PredicateBuilder';
import { useNotify } from '@/components/shell/notice';
import { Button } from '@/components/ui/Button';
import { FormDialog } from '@/components/ui/FormDialog';
import { ReadOnlyField, TextAreaField, TextField } from '@/components/ui/fields';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui/states';
import { t } from '@/i18n';
import type { SegmentRow } from '@/lib/api/admin-api';
import { useAdminApi } from '@/lib/auth/session';
import { useFormSubmit } from '@/lib/forms/useFormSubmit';
import { useResource } from '@/lib/hooks/useResource';
import type { Conversion } from '@/lib/predicate';

export function SegmentsPage() {
  const api = useAdminApi();
  const segments = useResource(() => api.config.segments(), [api]);
  const [editing, setEditing] = useState<SegmentRow | 'new' | null>(null);

  return (
    <>
      <PageHeader title={t('segments.title')} intro={t('segments.intro')} actions={<Button onClick={() => setEditing('new')}>{t('segments.newSegment')}</Button>} />
      {segments.status === 'loading' ? <LoadingState /> : null}
      {segments.status === 'error' ? <ErrorState error={segments.error} onRetry={segments.reload} /> : null}
      {segments.status === 'success' && segments.data.length === 0 ? <EmptyState message={t('segments.empty')} /> : null}
      {segments.status === 'success' && segments.data.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('common.key')}</th>
                <th scope="col">{t('common.description')}</th>
                <th scope="col">{t('segments.definition')}</th>
                <th scope="col">{t('segments.updatedAt')}</th>
                <th scope="col"><span className="visually-hidden">{t('common.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {segments.data.map((s) => (
                <tr key={s.id}>
                  <td><code>{s.key}</code></td>
                  <td>{s.description ?? '—'}</td>
                  <td><code className="muted">{JSON.stringify(s.definition).slice(0, 120)}</code></td>
                  <td><time dateTime={s.updated_at}>{new Date(s.updated_at).toLocaleString()}</time></td>
                  <td className="table__actions">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(s)} aria-label={`${t('common.edit')} ${s.key}`}>{t('common.edit')}</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {editing ? <SegmentDialog segment={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={segments.reload} /> : null}
    </>
  );
}

function SegmentDialog({ segment, onClose, onSaved }: { segment: SegmentRow | null; onClose: () => void; onSaved: () => void }) {
  const api = useAdminApi();
  const notify = useNotify();
  const { busy, error, fieldErrors, submit } = useFormSubmit();
  const [key, setKey] = useState(segment?.key ?? '');
  const [description, setDescription] = useState(segment?.description ?? '');
  const [definition, setDefinition] = useState<Conversion | null>(null);

  async function save() {
    const extra: Record<string, string> = definition && !definition.ok ? { definition: conversionMessage(definition) } : {};
    const payload = { key: segment?.key ?? key.trim(), description: description.trim() || undefined, definition: definition?.ok ? definition.value : undefined };
    const ok = await submit(adminSegmentUpsert, payload, (d) => api.config.upsertSegment(d), extra);
    if (ok) {
      notify(segment ? t('common.saved') : t('common.created'));
      onSaved();
      onClose();
    }
  }

  return (
    <FormDialog title={segment ? t('segments.editSegment', { key: segment.key }) : t('segments.newSegment')} onClose={onClose} onSubmit={() => void save()} busy={busy} error={error} fieldErrors={fieldErrors} size="lg">
      {segment ? (
        <ReadOnlyField label={t('common.key')} value={segment.key} hint={t('common.immutableHint')} />
      ) : (
        <TextField label={t('common.key')} hint={t('validation.keyFormat')} value={key} onChange={setKey} error={fieldErrors.key} required data-autofocus spellCheck={false} />
      )}
      <TextAreaField label={t('common.description')} value={description} onChange={setDescription} error={fieldErrors.description} rows={2} maxLength={500} />
      <PredicateBuilder initial={segment?.definition ?? null} onChange={setDefinition} />
      {fieldErrors.definition ? <p className="field__error" role="alert">{fieldErrors.definition}</p> : null}
    </FormDialog>
  );
}
