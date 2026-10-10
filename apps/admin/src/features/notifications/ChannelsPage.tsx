'use client';

import { useState } from 'react';
import { RequirePermission } from '@/components/shell/RouteGuard';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { BoolBadge, EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui/states';
import { t } from '@/i18n';
import type { ChannelConfigRow } from '@/lib/api/modules/notifications';
import { useAdminApi, useSession } from '@/lib/auth/session';
import { formatDateTime, formatNumber } from '@/lib/format';
import { useResource } from '@/lib/hooks/useResource';
import { ChannelDialog } from './ChannelDialog';
import { channelLabel, NotificationsTabs } from './shared';

/** `/notifications/channels` — delivery provider configuration (notifications.channels). */
export function ChannelsPage() {
  const { admin } = useSession();
  return (
    <RequirePermission permission="notifications.channels" permissions={admin?.permissions ?? []}>
      <Channels />
    </RequirePermission>
  );
}

function Channels() {
  const api = useAdminApi();
  const rows = useResource(() => api.notifications.channels(), [api]);
  const [editing, setEditing] = useState<ChannelConfigRow | 'new' | null>(null);

  return (
    <>
      <PageHeader
        title={t('notifications.channelsPage.title')}
        intro={t('notifications.channelsPage.intro')}
        actions={<Button onClick={() => setEditing('new')}>{t('notifications.channelsPage.add')}</Button>}
      />
      <NotificationsTabs />
      {rows.status === 'loading' ? <LoadingState /> : null}
      {rows.status === 'error' ? <ErrorState error={rows.error} onRetry={rows.reload} /> : null}
      {rows.status === 'success' && rows.data.length === 0 ? <EmptyState message={t('notifications.channelsPage.empty')} /> : null}
      {rows.status === 'success' && rows.data.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('notifications.channelsPage.channel')}</th>
                <th scope="col">{t('notifications.channelsPage.provider')}</th>
                <th scope="col">{t('notifications.channelsPage.enabled')}</th>
                <th scope="col" className="num">{t('notifications.channelsPage.priority')}</th>
                <th scope="col">{t('notifications.channelsPage.countries')}</th>
                <th scope="col">{t('notifications.channelsPage.secret')}</th>
                <th scope="col">{t('notifications.channelsPage.updatedAt')}</th>
                <th scope="col"><span className="visually-hidden">{t('common.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.data.map((r) => {
                const name = `${channelLabel(r.channel)} ${r.provider}`;
                return (
                  <tr key={`${r.channel}:${r.provider}`}>
                    <td>{channelLabel(r.channel)}</td>
                    <td><code>{r.provider}</code></td>
                    <td><BoolBadge value={r.is_enabled} on={t('notifications.channelsPage.on')} off={t('notifications.channelsPage.off')} /></td>
                    <td className="num">{formatNumber(r.priority)}</td>
                    <td>{r.country_codes?.length ? r.country_codes.join(', ') : t('notifications.channelsPage.allCountries')}</td>
                    <td>{r.secret_ref ? <Badge tone="success">{t('notifications.channelsPage.secretConfigured')}</Badge> : <Badge tone="warning">{t('notifications.channelsPage.secretMissing')}</Badge>}</td>
                    <td>{formatDateTime(r.updated_at)}</td>
                    <td className="table__actions">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(r)} aria-label={`${t('common.edit')} ${name}`}>{t('common.edit')}</Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {editing ? <ChannelDialog row={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={rows.reload} /> : null}
    </>
  );
}
