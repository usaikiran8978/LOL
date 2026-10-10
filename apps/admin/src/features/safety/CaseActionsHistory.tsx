'use client';

import { useState } from 'react';
import { z } from 'zod';
import { useNotify } from '@/components/shell/notice';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { TextAreaField } from '@/components/ui/fields';
import { EmptyState } from '@/components/ui/states';
import { t } from '@/i18n';
import { reverseSchema, type ModerationActionRow } from '@/lib/api/modules/safety';
import { useSession } from '@/lib/auth/session';
import { formatDateTime } from '@/lib/format';
import { validate } from '@/lib/forms/validate';
import { label } from './labels';

/** Actions with an automatic inverse in ModerationService.reverse(); others are only marked as reversed. */
const INVERSE: Partial<Record<ModerationActionRow['action'], ModerationActionRow['action']>> = {
  ban: 'unban', suspend: 'unsuspend', restrict: 'lift_restriction', remove_content: 'restore_content', verify: 'unverify', unverify: 'verify',
};

// The API accepts an empty note; the console requires a reason so every reversal is explained in the audit trail.
const reverseForm = reverseSchema.extend({ note: z.string().trim().min(1).max(3000) });

function paramsSummary(a: ModerationActionRow): string {
  const parts: string[] = [];
  const p = a.params ?? {};
  if (p.durationHours) parts.push(t('safety.history.duration', { hours: p.durationHours }));
  if (p.restrictionKinds?.length) parts.push(p.restrictionKinds.map((k) => label('restrictionKind', k)).join(', '));
  if (a.content_type) parts.push(`${label('contentType', a.content_type)}${a.content_id ? ` ${a.content_id}` : ''}`);
  return parts.join(' · ');
}

/** The subject's moderation history (last 50 actions) with reversal. */
export function CaseActionsHistory({ actions, onChanged }: { actions: ModerationActionRow[]; onChanged: () => void }) {
  const { can, admin } = useSession();
  const [reversing, setReversing] = useState<ModerationActionRow | null>(null);
  // Reversing a ban/unban also needs moderation.ban (the API enforces it as well).
  const canReverse = (a: ModerationActionRow) => can('moderation.action') && !a.reversed_at && ((a.action !== 'ban' && a.action !== 'unban') || can('moderation.ban'));

  return (
    <section className="section" aria-labelledby="case-actions">
      <h2 id="case-actions">{t('safety.history.title')}</h2>
      {actions.length === 0 ? (
        <EmptyState message={t('safety.history.empty')} />
      ) : (
        <div className="table-wrap">
          <table className="table table--compact">
            <thead>
              <tr>
                <th scope="col">{t('safety.history.when')}</th>
                <th scope="col">{t('safety.history.action')}</th>
                <th scope="col">{t('safety.history.reason')}</th>
                <th scope="col">{t('safety.history.details')}</th>
                <th scope="col">{t('safety.history.actor')}</th>
                <th scope="col">{t('safety.history.state')}</th>
                <th scope="col"><span className="visually-hidden">{t('common.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {actions.map((a) => (
                <tr key={a.id}>
                  <td><time dateTime={a.created_at}>{formatDateTime(a.created_at)}</time></td>
                  <td>{label('actionType', a.action)}</td>
                  <td><code>{a.reason_key}</code>{a.params?.note ? <div className="muted pre-wrap">{a.params.note}</div> : null}</td>
                  <td>{paramsSummary(a) || '—'}</td>
                  <td>{a.actor_type === 'system' ? t('safety.history.system') : a.actor_id === admin?.id ? t('safety.cases.you') : <code>{a.actor_id ?? '—'}</code>}</td>
                  <td>{a.reversed_at ? <Badge tone="neutral">{t('safety.history.reversedAt', { at: formatDateTime(a.reversed_at) })}</Badge> : <Badge tone="info">{t('safety.history.inEffect')}</Badge>}</td>
                  <td className="table__actions">
                    {canReverse(a) ? (
                      <Button variant="ghost" size="sm" onClick={() => setReversing(a)} aria-label={`${t('safety.history.reverse')} ${label('actionType', a.action)} ${formatDateTime(a.created_at)}`}>{t('safety.history.reverse')}</Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {reversing ? <ReverseDialog action={reversing} onClose={() => setReversing(null)} onDone={onChanged} /> : null}
    </section>
  );
}

function ReverseDialog({ action, onClose, onDone }: { action: ModerationActionRow; onClose: () => void; onDone: () => void }) {
  const { api } = useSession();
  const notify = useNotify();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | undefined>();
  const inverse = INVERSE[action.action];

  async function confirm(): Promise<boolean> {
    const v = validate(reverseForm, { note });
    if (!v.ok) {
      setError(v.errors.note);
      return false;
    }
    setError(undefined);
    await api.safety.reverse(action.id, v.data);
    notify(t('safety.history.reversed'));
    onDone();
    return true;
  }

  return (
    <ConfirmDialog
      title={t('safety.history.reverseTitle', { action: label('actionType', action.action) })}
      body={inverse ? t('safety.history.reverseBody', { inverse: label('actionType', inverse) }) : t('safety.history.reverseMarkOnly')}
      confirmLabel={t('safety.history.reverse')}
      tone="danger"
      onConfirm={confirm}
      onClose={onClose}
    >
      <TextAreaField label={t('safety.history.reverseReason')} value={note} onChange={setNote} error={error} rows={3} maxLength={3000} required />
    </ConfirmDialog>
  );
}
