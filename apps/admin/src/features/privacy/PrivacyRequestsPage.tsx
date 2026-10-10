'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useNotify } from '@/components/shell/notice';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { SelectField } from '@/components/ui/fields';
import { LoadMore } from '@/components/ui/LoadMore';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui/states';
import { t } from '@/i18n';
import { DSAR_STATUSES, type DsarRequest, type DsarStatus } from '@/lib/api/modules/privacy';
import { useAdminApi, useSession } from '@/lib/auth/session';
import { formatDateTime } from '@/lib/format';
import { useCursorList } from '@/lib/hooks/useCursorList';
import { CreateRequestDialog } from './CreateRequestDialog';
import { kindLabel, statusLabel, urgency } from './labels';

const EXECUTABLE: DsarStatus[] = ['received', 'verifying'];
const PAGE_SIZE = 50;

export function PrivacyRequestsPage() {
  const api = useAdminApi();
  const { can } = useSession();
  const pii = can('users.view_pii');
  const [status, setStatus] = useState<'' | DsarStatus>('');
  const list = useCursorList((cursor) => api.privacy.requests({ status: status || undefined, cursor, limit: PAGE_SIZE }), [api, status]);
  const [creating, setCreating] = useState(false);
  const [executing, setExecuting] = useState<DsarRequest | null>(null);
  const now = Date.now();

  return (
    <>
      <PageHeader title={t('privacy.requests.title')} intro={t('privacy.requests.intro')} actions={<Button onClick={() => setCreating(true)}>{t('privacy.requests.newRequest')}</Button>} />
      <div className="filters">
        <SelectField
          label={t('privacy.requests.filter')}
          value={status}
          onChange={(v) => setStatus(v as '' | DsarStatus)}
          options={[{ value: '', label: t('privacy.requests.open') }, ...DSAR_STATUSES.map((s) => ({ value: s, label: statusLabel(s) }))]}
          className="field--inline"
        />
      </div>
      {list.status === 'loading' ? <LoadingState /> : null}
      {list.status === 'error' ? <ErrorState error={list.error} onRetry={list.reload} /> : null}
      {list.status === 'ready' && list.items.length === 0 ? <EmptyState message={t('privacy.requests.empty')} /> : null}
      {list.status === 'ready' && list.items.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <caption className="visually-hidden">{t('privacy.requests.caption')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('privacy.requests.dueAt')}</th>
                <th scope="col">{t('privacy.requests.kind')}</th>
                <th scope="col">{t('common.status')}</th>
                <th scope="col">{t('privacy.requests.user')}</th>
                {pii ? <th scope="col">{t('privacy.requests.subjectEmail')}</th> : null}
                <th scope="col">{t('privacy.requests.regime')}</th>
                <th scope="col">{t('privacy.requests.createdAt')}</th>
                <th scope="col">{t('privacy.requests.notes')}</th>
                <th scope="col"><span className="visually-hidden">{t('common.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((r) => {
                const u = urgency(r, now);
                return (
                  <tr key={r.id} className={u === 'overdue' ? 'is-danger' : u === 'dueSoon' ? 'is-warning' : undefined}>
                    <td>
                      <time dateTime={r.due_at}>{formatDateTime(r.due_at)}</time>
                      {u === 'overdue' ? <> <Badge tone="danger">{t('privacy.requests.overdue')}</Badge></> : null}
                      {u === 'dueSoon' ? <> <Badge tone="warning">{t('privacy.requests.dueSoon')}</Badge></> : null}
                    </td>
                    <td>{kindLabel(r.kind)}</td>
                    <td>
                      {statusLabel(r.status)}
                      {r.completed_at ? <div className="muted">{t('privacy.requests.completedAt')}: {formatDateTime(r.completed_at)}</div> : null}
                    </td>
                    <td>
                      {r.user_id
                        ? (can('users.view') ? <Link href={`/users/${encodeURIComponent(r.user_id)}`}><code>{r.user_id}</code></Link> : <code>{r.user_id}</code>)
                        : <span className="muted">{t('privacy.requests.userGone')}</span>}
                    </td>
                    {pii ? <td>{r.subject_email ?? '—'}</td> : null}
                    <td>{r.regime ?? '—'}</td>
                    <td>{formatDateTime(r.created_at)}</td>
                    <td>{r.notes ? <span className="pre-wrap">{r.notes}</span> : '—'}</td>
                    <td className="table__actions">
                      {EXECUTABLE.includes(r.status) && r.user_id ? (
                        <Button
                          size="sm"
                          variant={r.kind === 'delete' ? 'danger' : 'primary'}
                          onClick={() => setExecuting(r)}
                          aria-label={`${t('privacy.requests.execute')} ${kindLabel(r.kind)} ${r.user_id}`}
                        >
                          {t('privacy.requests.execute')}
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <LoadMore list={list} />
        </div>
      ) : null}
      {creating ? <CreateRequestDialog onClose={() => setCreating(false)} onCreated={list.reload} /> : null}
      {executing ? <ExecuteDialog request={executing} onClose={() => setExecuting(null)} onDone={list.reload} /> : null}
    </>
  );
}

function ExecuteDialog({ request, onClose, onDone }: { request: DsarRequest; onClose: () => void; onDone: () => void }) {
  const api = useAdminApi();
  const notify = useNotify();
  const user = request.user_id ?? '';
  const isDelete = request.kind === 'delete';
  const body = isDelete
    ? t('privacy.execute.deleteBody', { user })
    : request.kind === 'export' ? t('privacy.execute.exportBody', { user }) : t('privacy.execute.otherBody');
  return (
    <ConfirmDialog
      title={t('privacy.execute.title', { kind: kindLabel(request.kind) })}
      body={body}
      tone={isDelete ? 'danger' : 'primary'}
      confirmLabel={isDelete ? t('privacy.execute.confirmDelete') : t('privacy.execute.confirm')}
      // Deletion purges the account irreversibly: the admin must type the user's ID.
      confirmPhrase={isDelete ? user : undefined}
      onClose={onClose}
      onConfirm={async () => {
        await api.privacy.executeRequest(request.id);
        notify(t('privacy.execute.done'));
        onDone();
      }}
    />
  );
}
