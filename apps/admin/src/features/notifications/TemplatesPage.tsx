'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { BoolBadge, EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui/states';
import { t } from '@/i18n';
import type { NotificationTemplate } from '@/lib/api/modules/notifications';
import { useAdminApi } from '@/lib/auth/session';
import { useResource } from '@/lib/hooks/useResource';
import { categoryLabel, channelLabel, NotificationsTabs } from './shared';
import { TemplateDialog } from './TemplateDialog';

function versionSummary(tpl: NotificationTemplate) {
  const published = tpl.versions.find((v) => v.status === 'published');
  const drafts = tpl.versions.filter((v) => v.status === 'draft').length;
  return (
    <span className="row">
      {published ? <Badge tone="success">{t('notifications.templates.publishedVersion', { version: published.version })}</Badge> : <Badge tone="warning">{t('notifications.templates.noPublished')}</Badge>}
      {drafts ? <Badge tone="info">{t('notifications.templates.draftCount', { count: drafts })}</Badge> : null}
    </span>
  );
}

/** `/notifications` — template catalogue (notifications.manage). */
export function TemplatesPage() {
  const api = useAdminApi();
  const templates = useResource(() => api.notifications.templates(), [api]);
  const [editing, setEditing] = useState<NotificationTemplate | 'new' | null>(null);

  return (
    <>
      <PageHeader
        title={t('notifications.title')}
        intro={t('notifications.templates.intro')}
        actions={<Button onClick={() => setEditing('new')}>{t('notifications.templates.new')}</Button>}
      />
      <NotificationsTabs />
      {templates.status === 'loading' ? <LoadingState /> : null}
      {templates.status === 'error' ? <ErrorState error={templates.error} onRetry={templates.reload} /> : null}
      {templates.status === 'success' && templates.data.length === 0 ? <EmptyState message={t('notifications.templates.empty')} /> : null}
      {templates.status === 'success' && templates.data.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('notifications.templates.key')}</th>
                <th scope="col">{t('notifications.templates.category')}</th>
                <th scope="col">{t('notifications.templates.channels')}</th>
                <th scope="col">{t('notifications.templates.versions')}</th>
                <th scope="col">{t('notifications.templates.transactional')}</th>
                <th scope="col">{t('common.status')}</th>
                <th scope="col"><span className="visually-hidden">{t('common.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {templates.data.map((tpl) => (
                <tr key={tpl.id}>
                  <td><Link href={`/notifications/templates/${encodeURIComponent(tpl.key)}`}><code>{tpl.key}</code></Link></td>
                  <td>{categoryLabel(tpl.category)}</td>
                  <td>{tpl.channels.map(channelLabel).join(', ')}</td>
                  <td>{versionSummary(tpl)}</td>
                  <td><BoolBadge value={tpl.is_transactional} /></td>
                  <td><BoolBadge value={tpl.is_active} on={t('common.active')} off={t('common.inactive')} /></td>
                  <td className="table__actions">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(tpl)} aria-label={`${t('notifications.templates.editSettings')} ${tpl.key}`}>{t('notifications.templates.editSettings')}</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {editing ? <TemplateDialog template={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={templates.reload} /> : null}
    </>
  );
}
