'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useNotify } from '@/components/shell/notice';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge } from '@/components/ui/states';
import { t } from '@/i18n';
import type { MatchingConfigSummary } from '@/lib/api/modules/matching';
import { useAdminApi, useSession } from '@/lib/auth/session';
import { formatDateTime } from '@/lib/format';
import { useResource } from '@/lib/hooks/useResource';
import { CreateDraftDialog } from './CreateDraftDialog';
import { MatchingTabs, versionLabel } from './shared';

/** Matching config versions (draft → published → archived) with draft creation and deletion. */
export function ConfigVersionsPage() {
  const api = useAdminApi();
  const { can } = useSession();
  const notify = useNotify();
  const versions = useResource(() => api.matching.configs(), [api]);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<MatchingConfigSummary | null>(null);
  const canEdit = can('matching.edit');

  const list = versions.data ?? [];
  const draft = list.find((v) => v.status === 'draft');

  return (
    <>
      <PageHeader
        title={t('matching.title')}
        intro={t('matching.versions.intro')}
        actions={canEdit ? <Button onClick={() => setCreating(true)} disabled={versions.status !== 'success' || !!draft}>{t('matching.versions.newDraft')}</Button> : null}
      />
      <MatchingTabs />
      {versions.status === 'loading' ? <LoadingState /> : null}
      {versions.status === 'error' ? <ErrorState error={versions.error} onRetry={versions.reload} /> : null}
      {versions.status === 'success' && draft && canEdit ? (
        <p className="alert alert--info">
          {t('matching.versions.oneDraft')} <Link href={`/matching/configs/${draft.id}`}>{t('matching.versions.openDraft', { version: draft.version })}</Link>
        </p>
      ) : null}
      {versions.status === 'success' && list.length === 0 ? <EmptyState message={t('matching.versions.empty')} /> : null}
      {versions.status === 'success' && list.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('matching.versions.version')}</th>
                <th scope="col">{t('common.status')}</th>
                <th scope="col">{t('matching.versions.notes')}</th>
                <th scope="col">{t('matching.versions.createdAt')}</th>
                <th scope="col">{t('matching.versions.publishedAt')}</th>
                <th scope="col"><span className="visually-hidden">{t('common.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {list.map((v) => (
                <tr key={v.id}>
                  <td>{versionLabel(v.version)}</td>
                  <td><StatusBadge status={v.status} /></td>
                  <td className="pre-wrap">{v.notes || '—'}</td>
                  <td>{formatDateTime(v.created_at)}</td>
                  <td>{formatDateTime(v.published_at)}</td>
                  <td className="table__actions">
                    <Link className="btn btn--ghost btn--sm" href={`/matching/configs/${v.id}`} aria-label={`${v.status === 'draft' && canEdit ? t('common.edit') : t('common.view')} ${versionLabel(v.version)}`}>
                      {v.status === 'draft' && canEdit ? t('common.edit') : t('common.view')}
                    </Link>
                    {v.status === 'draft' && canEdit ? (
                      <Button variant="ghost" size="sm" onClick={() => setDeleting(v)} aria-label={`${t('matching.versions.deleteDraft')} ${versionLabel(v.version)}`}>{t('matching.versions.deleteDraft')}</Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {creating ? <CreateDraftDialog versions={list} onClose={() => setCreating(false)} /> : null}
      {deleting ? (
        <ConfirmDialog
          title={t('matching.versions.deleteTitle', { version: deleting.version })}
          body={t('matching.versions.deleteBody')}
          confirmLabel={t('matching.versions.deleteDraft')}
          tone="danger"
          confirmPhrase={versionLabel(deleting.version)}
          onConfirm={async () => {
            await api.matching.deleteDraft(deleting.id);
            notify(t('matching.versions.deleted', { version: deleting.version }));
            versions.reload();
          }}
          onClose={() => setDeleting(null)}
        />
      ) : null}
    </>
  );
}
