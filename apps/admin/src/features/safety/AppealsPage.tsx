'use client';

import { adminAppealDecision } from '@amora/shared';
import Link from 'next/link';
import { useState } from 'react';
import { useNotify } from '@/components/shell/notice';
import { RequirePermission } from '@/components/shell/RouteGuard';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { SelectField, TextAreaField } from '@/components/ui/fields';
import { LoadMore } from '@/components/ui/LoadMore';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui/states';
import { t } from '@/i18n';
import { ApiError } from '@/lib/api/client';
import { APPEAL_STATUSES, type AppealRow } from '@/lib/api/modules/safety';
import { useSession } from '@/lib/auth/session';
import { formatDateTime } from '@/lib/format';
import { validate } from '@/lib/forms/validate';
import { useCursorList } from '@/lib/hooks/useCursorList';
import { enumOptions, label } from './labels';
import { ModerationTabs } from './ModerationTabs';

const PAGE_SIZE = 50;
const OPEN = ['submitted', 'in_review'];
/** Reversing (overturning) these also needs `moderation.ban`. */
const BAN_ACTIONS = ['ban', 'unban'];

export function AppealsPage() {
  const { admin } = useSession();
  return (
    <RequirePermission permission="moderation.appeals" permissions={admin?.permissions ?? []}>
      <AppealsList />
    </RequirePermission>
  );
}

function AppealsList() {
  const { api, admin, can } = useSession();
  const [status, setStatus] = useState('');
  const list = useCursorList((cursor) => api.safety.appeals({ status: status || undefined, cursor, limit: PAGE_SIZE }), [api, status]);
  const [deciding, setDeciding] = useState<{ appeal: AppealRow; decision: 'upheld' | 'overturned' } | null>(null);
  // Appeals the API refused for this admin although the listing did not flag them (fallback for the FORBIDDEN rule).
  const [blocked, setBlocked] = useState<ReadonlySet<string>>(new Set());
  const ownAction = (a: AppealRow) => (!!admin?.id && a.actor_id === admin.id) || blocked.has(a.id);
  const canOverturn = (a: AppealRow) => !BAN_ACTIONS.includes(a.action) || can('moderation.ban');

  return (
    <>
      <PageHeader title={t('safety.appeals.title')} intro={t('safety.appeals.intro')} />
      <ModerationTabs />
      <p className="alert alert--info">{t('safety.appeals.differentReviewer')}</p>
      <div className="filters">
        <SelectField label={t('safety.appeals.status')} value={status} onChange={setStatus} placeholder={t('safety.appeals.pendingStatuses')} options={enumOptions('appealStatus', APPEAL_STATUSES)} className="field--inline" />
      </div>
      {list.status === 'loading' ? <LoadingState /> : null}
      {list.status === 'error' ? <ErrorState error={list.error} onRetry={list.reload} /> : null}
      {list.status === 'ready' && list.items.length === 0 ? <EmptyState message={t('safety.appeals.empty')} /> : null}
      {list.status === 'ready' && list.items.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <caption className="table__caption">{t('safety.appeals.title')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('safety.appeals.submitted')}</th>
                <th scope="col">{t('safety.appeals.user')}</th>
                <th scope="col">{t('safety.appeals.action')}</th>
                <th scope="col">{t('safety.appeals.statement')}</th>
                <th scope="col">{t('safety.appeals.status')}</th>
                <th scope="col"><span className="visually-hidden">{t('common.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((a) => (
                <tr key={a.id}>
                  <td><time dateTime={a.created_at}>{formatDateTime(a.created_at)}</time></td>
                  <td><code>{a.user_id}</code></td>
                  <td>
                    {label('actionType', a.action)} · <code>{a.reason_key}</code>
                    {a.case_id ? <div><Link href={`/moderation/cases/${a.case_id}`}>{t('safety.appeals.viewCase')}</Link></div> : null}
                  </td>
                  <td className="pre-wrap">{a.statement}</td>
                  <td>{label('appealStatus', a.status)}</td>
                  <td className="table__actions">
                    {OPEN.includes(a.status) && ownAction(a) ? <span className="muted">{t('safety.appeals.blockedForYou')}</span> : null}
                    {OPEN.includes(a.status) && !ownAction(a) ? (
                      <>
                        <Button variant="secondary" size="sm" onClick={() => setDeciding({ appeal: a, decision: 'upheld' })} aria-label={`${t('safety.appeals.uphold')} ${a.id}`}>{t('safety.appeals.uphold')}</Button>
                        {canOverturn(a) ? (
                          <Button variant="danger" size="sm" onClick={() => setDeciding({ appeal: a, decision: 'overturned' })} aria-label={`${t('safety.appeals.overturn')} ${a.id}`}>{t('safety.appeals.overturn')}</Button>
                        ) : (
                          <span className="muted">{t('safety.appeals.overturnNeedsBan')}</span>
                        )}
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <LoadMore list={list} />
        </div>
      ) : null}
      {deciding ? <DecisionDialog appeal={deciding.appeal} decision={deciding.decision} onClose={() => setDeciding(null)} onDone={list.reload} onSameReviewer={() => setBlocked((b) => new Set(b).add(deciding.appeal.id))} /> : null}
    </>
  );
}

function DecisionDialog({ appeal, decision, onClose, onDone, onSameReviewer }: {
  appeal: AppealRow; decision: 'upheld' | 'overturned'; onClose: () => void; onDone: () => void; onSameReviewer: () => void;
}) {
  const { api } = useSession();
  const notify = useNotify();
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | undefined>();
  const [sameReviewer, setSameReviewer] = useState(false);

  async function confirm(): Promise<boolean> {
    const v = validate(adminAppealDecision, { decision, note: note.trim() || undefined });
    if (!v.ok) {
      setNoteError(v.errors.note);
      return false;
    }
    setNoteError(undefined);
    try {
      await api.safety.decideAppeal(appeal.id, v.data);
    } catch (e) {
      // The admin holds moderation.appeals (or this page would not render) and the listing already hides own
      // actions and ban overturns without moderation.ban, so FORBIDDEN here is the API's "different reviewer"
      // rule for an appeal the listing did not flag (fallback). A missing-permission refusal names the permission.
      const missing = e instanceof ApiError ? (e.details as { missing?: string[] } | undefined)?.missing : undefined;
      if (e instanceof ApiError && e.code === 'FORBIDDEN' && !missing?.length) {
        setSameReviewer(true);
        onSameReviewer();
        return false;
      }
      throw e;
    }
    notify(decision === 'upheld' ? t('safety.appeals.upheldDone') : t('safety.appeals.overturnedDone'));
    onDone();
    return true;
  }

  return (
    <ConfirmDialog
      title={decision === 'upheld' ? t('safety.appeals.upholdTitle') : t('safety.appeals.overturnTitle')}
      body={decision === 'upheld' ? t('safety.appeals.upholdBody', { action: label('actionType', appeal.action) }) : t('safety.appeals.overturnBody', { action: label('actionType', appeal.action) })}
      confirmLabel={decision === 'upheld' ? t('safety.appeals.uphold') : t('safety.appeals.overturn')}
      tone={decision === 'overturned' ? 'danger' : 'primary'}
      onConfirm={confirm}
      onClose={onClose}
    >
      {sameReviewer ? <p className="alert alert--error" role="alert">{t('safety.appeals.sameReviewerError')}</p> : null}
      <TextAreaField label={t('safety.appeals.note')} value={note} onChange={setNote} error={noteError} rows={3} maxLength={3000} />
    </ConfirmDialog>
  );
}
