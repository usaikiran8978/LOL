'use client';

import Link from 'next/link';
import { useState } from 'react';
import { RequirePermission } from '@/components/shell/RouteGuard';
import { useNotify } from '@/components/shell/notice';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { DefinitionList } from '@/components/ui/DefinitionList';
import { BoolBadge, EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge } from '@/components/ui/states';
import { t } from '@/i18n';
import type { NotificationTemplate, TemplateVersionSummary } from '@/lib/api/modules/notifications';
import { useAdminApi, useSession } from '@/lib/auth/session';
import { formatDateTime } from '@/lib/format';
import { useResource } from '@/lib/hooks/useResource';
import { PreviewPanel } from './PreviewPanel';
import { categoryLabel, channelLabel, NotificationsTabs } from './shared';
import { TemplateDialog } from './TemplateDialog';
import { blankSeed, seedFromVersion, VersionEditorDialog, type VersionSeed } from './VersionEditorDialog';
import { VersionView } from './VersionView';

/** `/notifications/templates/[key]` — settings, versions, contents per locale/channel, preview and test send. */
export function TemplateDetailPage({ templateKey }: { templateKey: string }) {
  const { admin } = useSession();
  return (
    <RequirePermission permission="notifications.manage" permissions={admin?.permissions ?? []}>
      <TemplateDetail templateKey={templateKey} />
    </RequirePermission>
  );
}

function TemplateDetail({ templateKey }: { templateKey: string }) {
  const api = useAdminApi();
  const templates = useResource(() => api.notifications.templates(), [api]);
  const [selected, setSelected] = useState<number | null>(null);
  const [drafting, setDrafting] = useState<VersionSeed | null>(null);
  const [editing, setEditing] = useState(false);
  const [publishing, setPublishing] = useState<TemplateVersionSummary | null>(null);

  const back = <Link href="/notifications">{t('notifications.templates.back')}</Link>;
  if (templates.status === 'loading') return <LoadingState />;
  if (templates.status === 'error') return <ErrorState error={templates.error} onRetry={templates.reload} />;
  const tpl = templates.data.find((x) => x.key === templateKey);
  if (!tpl) return <EmptyState message={t('notifications.templates.notFound', { key: templateKey })} action={back} />;

  const published = tpl.versions.find((v) => v.status === 'published') ?? null;
  const shown = selected ?? published?.version ?? tpl.versions[0]?.version ?? null;

  return (
    <>
      <PageHeader
        title={t('notifications.templates.detailTitle', { key: tpl.key })}
        intro={t('notifications.templates.detailIntro')}
        actions={
          <>
            <Button variant="secondary" onClick={() => setEditing(true)}>{t('notifications.templates.editSettings')}</Button>
            <Button onClick={() => setDrafting(blankSeed(tpl))}>{t('notifications.versions.new')}</Button>
          </>
        }
      />
      <NotificationsTabs />
      <p>{back}</p>
      <section className="card">
        <h2 className="card__title">{t('notifications.templates.settings')}</h2>
        <SettingsList tpl={tpl} />
      </section>
      <section className="card">
        <h2 className="card__title">{t('notifications.versions.heading')}</h2>
        {tpl.versions.length === 0 ? (
          <EmptyState message={t('notifications.versions.empty')} action={<Button onClick={() => setDrafting(blankSeed(tpl))}>{t('notifications.versions.new')}</Button>} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t('notifications.versions.version')}</th>
                  <th scope="col">{t('common.status')}</th>
                  <th scope="col">{t('notifications.versions.publishedAt')}</th>
                  <th scope="col"><span className="visually-hidden">{t('common.actions')}</span></th>
                </tr>
              </thead>
              <tbody>
                {tpl.versions.map((v) => {
                  const name = t('notifications.versions.versionShort', { version: v.version });
                  return (
                    <tr key={v.id} className={v.version === shown ? 'is-selected' : undefined}>
                      <td>{name}</td>
                      <td><StatusBadge status={v.status} /></td>
                      <td>{formatDateTime(v.published_at)}</td>
                      <td className="table__actions">
                        <Button variant="ghost" size="sm" onClick={() => setSelected(v.version)} aria-label={`${t('common.view')} ${name}`} aria-pressed={v.version === shown}>{t('common.view')}</Button>
                        {v.status === 'draft' ? (
                          <Button size="sm" onClick={() => setPublishing(v)} aria-label={`${t('notifications.versions.publish')} ${name}`}>{t('notifications.versions.publish')}</Button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {shown !== null ? <VersionView key={shown} templateKey={tpl.key} version={shown} onCopy={(d) => setDrafting(seedFromVersion(d))} /> : null}
      <PreviewPanel template={tpl} version={tpl.versions.find((v) => v.version === shown) ?? null} />

      {editing ? <TemplateDialog template={tpl} onClose={() => setEditing(false)} onSaved={templates.reload} /> : null}
      {drafting ? (
        <VersionEditorDialog
          template={tpl}
          seed={drafting}
          onClose={() => setDrafting(null)}
          onCreated={(version) => {
            setSelected(version);
            templates.reload();
          }}
        />
      ) : null}
      {publishing ? <PublishDialog tpl={tpl} version={publishing} current={published} onClose={() => setPublishing(null)} onPublished={templates.reload} /> : null}
    </>
  );
}

function SettingsList({ tpl }: { tpl: NotificationTemplate }) {
  return (
    <DefinitionList
      items={[
        { label: t('notifications.templates.category'), value: categoryLabel(tpl.category) },
        { label: t('notifications.templates.channels'), value: tpl.channels.map(channelLabel).join(', ') },
        { label: t('notifications.templates.transactional'), value: <BoolBadge value={tpl.is_transactional} /> },
        { label: t('notifications.templates.quietHours'), value: <BoolBadge value={tpl.respects_quiet_hours} /> },
        { label: t('notifications.templates.deepLink'), value: tpl.deep_link_pattern ? <code>{tpl.deep_link_pattern}</code> : '—' },
        { label: t('common.status'), value: <BoolBadge value={tpl.is_active} on={t('common.active')} off={t('common.inactive')} /> },
      ]}
    />
  );
}

function PublishDialog({ tpl, version, current, onClose, onPublished }: {
  tpl: NotificationTemplate; version: TemplateVersionSummary; current: TemplateVersionSummary | null; onClose: () => void; onPublished: () => void;
}) {
  const api = useAdminApi();
  const notify = useNotify();
  return (
    <ConfirmDialog
      title={t('notifications.versions.publishTitle', { key: tpl.key, version: version.version })}
      body={
        <>
          <p>{t('notifications.versions.publishBody')}</p>
          {current ? <p>{t('notifications.versions.publishReplaces', { version: current.version })}</p> : null}
        </>
      }
      confirmLabel={t('notifications.versions.publish')}
      onConfirm={async () => {
        await api.notifications.publishVersion(tpl.key, version.version);
        notify(t('notifications.versions.published', { version: version.version }));
        onPublished();
      }}
      onClose={onClose}
    />
  );
}
