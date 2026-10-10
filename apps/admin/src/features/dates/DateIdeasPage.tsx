'use client';

import { useState } from 'react';
import { RequirePermission } from '@/components/shell/RouteGuard';
import { Button } from '@/components/ui/Button';
import { BoolBadge, EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui/states';
import { t } from '@/i18n';
import type { DateIdea } from '@/lib/api/modules/dates';
import { useSession } from '@/lib/auth/session';
import { useResource } from '@/lib/hooks/useResource';
import { DatesTabs } from './DatesTabs';
import { DateIdeaDialog, indoorLabel } from './DateIdeaDialog';

export function DateIdeasPage() {
  const { admin } = useSession();
  return (
    <RequirePermission permission="date_safety.manage" permissions={admin?.permissions ?? []}>
      <IdeasList />
    </RequirePermission>
  );
}

function IdeasList() {
  const { api } = useSession();
  const data = useResource(() => api.dates.ideas(), [api]);
  const [editing, setEditing] = useState<DateIdea | 'new' | null>(null);

  return (
    <>
      <PageHeader title={t('dates.ideas.title')} intro={t('dates.ideas.intro')} actions={<Button onClick={() => setEditing('new')}>{t('dates.ideas.newIdea')}</Button>} />
      <DatesTabs />
      {data.status === 'loading' ? <LoadingState /> : null}
      {data.status === 'error' ? <ErrorState error={data.error} onRetry={data.reload} /> : null}
      {data.status === 'success' && data.data.length === 0 ? <EmptyState message={t('dates.ideas.empty')} /> : null}
      {data.status === 'success' && data.data.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <caption className="table__caption">{t('dates.ideas.caption')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('common.key')}</th>
                <th scope="col">{t('dates.ideas.titleEn')}</th>
                <th scope="col">{t('dates.ideas.activityType')}</th>
                <th scope="col">{t('dates.ideas.budget')}</th>
                <th scope="col">{t('dates.ideas.stages')}</th>
                <th scope="col">{t('dates.ideas.timeOfDay')}</th>
                <th scope="col">{t('dates.ideas.duration')}</th>
                <th scope="col">{t('dates.ideas.indoor')}</th>
                <th scope="col">{t('common.status')}</th>
                <th scope="col"><span className="visually-hidden">{t('common.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((i) => (
                <tr key={i.id}>
                  <td><code>{i.key}</code></td>
                  <td dir="auto">{i.translations.en?.title ?? '—'}</td>
                  <td>{i.activityType}</td>
                  <td>{i.budgetKey ? <code>{i.budgetKey}</code> : '—'}</td>
                  <td>{i.dateStageKeys.length ? i.dateStageKeys.join(', ') : '—'}</td>
                  <td>{i.timeOfDay.length ? i.timeOfDay.map((x) => t(`dates.ideas.times.${x}`)).join(', ') : '—'}</td>
                  <td>{i.typicalDurationMin ? t('dates.ideas.durationValue', { minutes: i.typicalDurationMin }) : '—'}</td>
                  <td>{indoorLabel(i.indoor)}</td>
                  <td><BoolBadge value={i.isActive} on={t('common.active')} off={t('common.inactive')} /></td>
                  <td className="table__actions">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(i)} aria-label={`${t('common.edit')} ${i.key}`}>{t('common.edit')}</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {editing ? <DateIdeaDialog idea={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={data.reload} /> : null}
    </>
  );
}
