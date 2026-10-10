'use client';

import { eventCheckIn } from '@amora/shared';
import { useState } from 'react';
import { useNotify } from '@/components/shell/notice';
import { FormDialog } from '@/components/ui/FormDialog';
import { ReadOnlyField, SelectField, TextField } from '@/components/ui/fields';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { t } from '@/i18n';
import { ApiError } from '@/lib/api/client';
import type { AdminEventRow, RosterEntry } from '@/lib/api/modules/events';
import { useAdminApi } from '@/lib/auth/session';
import { validate, type FieldErrors } from '@/lib/forms/validate';
import { useResource } from '@/lib/hooks/useResource';

/** The API answers VALIDATION_FAILED with `details.ambiguous` when the code matches more than one attendee. */
function isAmbiguous(e: unknown): boolean {
  return e instanceof ApiError && e.code === 'VALIDATION_FAILED' && !!(e.details as { ambiguous?: boolean } | undefined)?.ambiguous;
}

const detailFlag = (e: unknown, code: string, flag: string) =>
  e instanceof ApiError && e.code === code && !!(e.details as Record<string, unknown> | undefined)?.[flag];
/** VALIDATION_FAILED with `details.invalidCode`: no registered attendee has this code. */
const isWrongCode = (e: unknown) => detailFlag(e, 'VALIDATION_FAILED', 'invalidCode');
/** CONFLICT with `details.alreadyCheckedIn`. */
const isAlreadyCheckedIn = (e: unknown) => detailFlag(e, 'CONFLICT', 'alreadyCheckedIn');

export const attendeeName = (a: Pick<RosterEntry, 'displayName' | 'userId'>) => a.displayName ?? a.userId;

/**
 * Checks an attendee in with the 6-character code from their ticket (`POST admin/events/:id/check-in`). The code
 * alone identifies the attendee; only when two codes collide does the admin pick the attendee from the roster.
 * Opened from a roster row, the attendee is already known. Check-in is open from 2 hours before the start until the end.
 */
export function CheckInDialog({ event, attendee, onClose, onDone }: { event: AdminEventRow; attendee?: RosterEntry; onClose: () => void; onDone?: () => void }) {
  const api = useAdminApi();
  const notify = useNotify();
  const [code, setCode] = useState('');
  const [picked, setPicked] = useState('');
  const [ambiguous, setAmbiguous] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  async function save() {
    const userId = attendee?.userId ?? (picked || undefined);
    const v = validate(eventCheckIn, { code: code.trim().toUpperCase(), userId });
    const errors: FieldErrors = v.ok ? {} : { ...v.errors };
    if (ambiguous && !userId) errors.userId = t('validation.required');
    if (!v.ok || Object.keys(errors).length) {
      setError(null);
      return setFieldErrors(errors);
    }
    setFieldErrors({});
    setError(null);
    setBusy(true);
    try {
      await api.events.checkIn(event.id, v.data);
      notify(attendee ? t('events.checkIn.doneNamed', { name: attendeeName(attendee) }) : t('events.checkIn.done'));
      onDone?.();
      onClose();
    } catch (e) {
      if (isAmbiguous(e)) setAmbiguous(true);
      else if (isWrongCode(e)) setFieldErrors({ code: t('events.checkIn.invalidCode') });
      else if (isAlreadyCheckedIn(e)) setFieldErrors({ code: t('events.checkIn.alreadyCheckedIn') });
      else setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormDialog title={t('events.checkIn.title', { title: event.title })} onClose={onClose} onSubmit={() => void save()} busy={busy} error={error} fieldErrors={fieldErrors} size="sm" submitLabel={t('events.checkIn.action')}>
      <p className="muted">{t('events.checkIn.intro')}</p>
      {attendee ? <ReadOnlyField label={t('events.checkIn.attendee')} value={attendeeName(attendee)} /> : null}
      <TextField
        label={t('events.checkIn.code')}
        hint={t('events.checkIn.codeHint')}
        value={code}
        onChange={(v) => setCode(v.toUpperCase())}
        error={fieldErrors.code}
        required
        spellCheck={false}
        maxLength={6}
        autoComplete="off"
        data-autofocus
      />
      {ambiguous && !attendee ? <AttendeePicker eventId={event.id} value={picked} onChange={setPicked} error={fieldErrors.userId} /> : null}
    </FormDialog>
  );
}

function AttendeePicker({ eventId, value, onChange, error }: { eventId: string; value: string; onChange: (v: string) => void; error?: string }) {
  const api = useAdminApi();
  const roster = useResource(() => api.events.attendees(eventId), [api, eventId]);
  return (
    <div className="stack">
      <p className="alert alert--info" role="alert">{t('events.checkIn.ambiguous')}</p>
      {roster.status === 'loading' ? <LoadingState /> : null}
      {roster.status === 'error' ? <ErrorState error={roster.error} onRetry={roster.reload} /> : null}
      {roster.status === 'success' ? (
        <SelectField
          label={t('events.checkIn.pickAttendee')}
          value={value}
          onChange={onChange}
          placeholder={t('events.form.choose')}
          options={roster.data.filter((a) => a.status === 'registered').map((a) => ({ value: a.userId, label: a.displayName ? `${a.displayName} (${a.userId})` : a.userId }))}
          error={error}
          required
        />
      ) : null}
    </div>
  );
}
