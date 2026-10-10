'use client';

import { adminEventDecision } from '@amora/shared';
import { useState } from 'react';
import { useNotify } from '@/components/shell/notice';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { TextAreaField } from '@/components/ui/fields';
import { t } from '@/i18n';
import type { AdminEventRow } from '@/lib/api/modules/events';
import { useAdminApi } from '@/lib/auth/session';
import { validate } from '@/lib/forms/validate';
import type { Decision } from './shared';

/** Publish / reject / cancel an event (`POST admin/events/:id/decision`). Cancelling is irreversible and typed-confirmed. */
export function DecisionDialog({ event, decision, onClose, onDone }: { event: AdminEventRow; decision: Decision; onClose: () => void; onDone: () => void }) {
  const api = useAdminApi();
  const notify = useNotify();
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | undefined>();

  return (
    <ConfirmDialog
      title={t(`events.decision.${decision}.title`, { title: event.title })}
      body={t(`events.decision.${decision}.body`)}
      confirmLabel={t(`events.decision.${decision}.action`)}
      tone={decision === 'publish' ? 'primary' : 'danger'}
      confirmPhrase={decision === 'cancel' ? t('events.decision.cancelPhrase') : undefined}
      onConfirm={async () => {
        const v = validate(adminEventDecision, { decision, note: note.trim() || undefined });
        if (!v.ok) {
          setNoteError(v.errors.note ?? t('validation.invalid'));
          return false;
        }
        setNoteError(undefined);
        await api.events.decide(event.id, v.data);
        notify(t(`events.decision.${decision}.done`, { title: event.title }));
        onDone();
      }}
      onClose={onClose}
    >
      <TextAreaField
        label={t('events.decision.note')}
        hint={decision === 'reject' ? t('events.decision.noteHintReject') : t('events.decision.noteHint')}
        value={note}
        onChange={setNote}
        error={noteError}
        maxLength={1000}
        rows={3}
      />
    </ConfirmDialog>
  );
}
