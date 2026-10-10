'use client';

import Link from 'next/link';
import { RequirePermission } from '@/components/shell/RouteGuard';
import { LoadMore } from '@/components/ui/LoadMore';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui/states';
import { t } from '@/i18n';
import { useSession } from '@/lib/auth/session';
import { formatDateTime } from '@/lib/format';
import { useCursorList } from '@/lib/hooks/useCursorList';
import { label } from './labels';

const PAGE_SIZE = 50;

export function VerificationQueuePage() {
  const { admin } = useSession();
  return (
    <RequirePermission permission="verification.view" permissions={admin?.permissions ?? []}>
      <Queue />
    </RequirePermission>
  );
}

function Queue() {
  const { api } = useSession();
  const list = useCursorList((cursor) => api.safety.verificationQueue({ cursor, limit: PAGE_SIZE }), [api]);
  return (
    <>
      <PageHeader title={t('safety.verification.title')} intro={t('safety.verification.intro')} />
      {list.status === 'loading' ? <LoadingState /> : null}
      {list.status === 'error' ? <ErrorState error={list.error} onRetry={list.reload} /> : null}
      {list.status === 'ready' && list.items.length === 0 ? <EmptyState message={t('safety.verification.empty')} /> : null}
      {list.status === 'ready' && list.items.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <caption className="table__caption">{t('safety.verification.title')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('safety.verification.submitted')}</th>
                <th scope="col">{t('safety.verification.user')}</th>
                <th scope="col">{t('safety.verification.kind')}</th>
                <th scope="col">{t('safety.verification.status')}</th>
                <th scope="col">{t('safety.verification.provider')}</th>
                <th scope="col">{t('safety.verification.pose')}</th>
                <th scope="col"><span className="visually-hidden">{t('common.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((r) => (
                <tr key={r.id}>
                  <td><time dateTime={r.submitted_at}>{formatDateTime(r.submitted_at)}</time></td>
                  <td>{r.display_name ?? '—'}<br /><code className="muted">{r.user_id}</code></td>
                  <td>{label('verificationKind', r.kind)}</td>
                  <td>{label('verificationStatus', r.status)}</td>
                  <td><code>{r.provider}</code></td>
                  <td>{label('pose', r.pose_challenge)}</td>
                  <td className="table__actions">
                    <Link href={`/verification/${r.id}`} className="btn btn--ghost btn--sm" aria-label={`${t('safety.verification.review')} ${r.display_name ?? r.user_id}`}>{t('safety.verification.review')}</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <LoadMore list={list} />
        </div>
      ) : null}
    </>
  );
}
