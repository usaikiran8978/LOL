'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { SelectField } from '@/components/ui/fields';
import { LoadMore } from '@/components/ui/LoadMore';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui/states';
import { t } from '@/i18n';
import { EVENT_STATUSES, type AdminEventRow, type EventStatus } from '@/lib/api/modules/events';
import { useAdminApi, useSession } from '@/lib/auth/session';
import { formatDateTime, formatNumber } from '@/lib/format';
import { useCursorList } from '@/lib/hooks/useCursorList';
import { CheckInDialog } from './CheckInDialog';
import { CreateEventDialog } from './CreateEventDialog';
import { DecisionDialog } from './DecisionDialog';
import { EditEventDialog } from './EditEventDialog';
import { EventDetailDialog } from './EventDetailDialog';
import { allowedDecisions, attendanceLabel, editable, EventStatusBadge, organizerLabel, priceLabel, statusLabel, type Decision } from './shared';

const PAGE_SIZE = 50;

/** `/events` — event moderation and operations (events.view; actions need events.manage). */
export function EventsPage() {
  const { can } = useSession();
  const canView = can('events.view');
  const canManage = can('events.manage');
  const [creating, setCreating] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  return (
    <>
      <PageHeader
        title={t('events.title')}
        intro={t('events.intro')}
        actions={canManage ? <Button onClick={() => setCreating(true)}>{t('events.create')}</Button> : undefined}
      />
      {canView ? <EventsList refresh={reloadKey} canManage={canManage} /> : null}
      {creating ? <CreateEventDialog onClose={() => setCreating(false)} onCreated={() => setReloadKey((k) => k + 1)} /> : null}
    </>
  );
}

function EventsList({ canManage, refresh }: { canManage: boolean; refresh: number }) {
  const api = useAdminApi();
  const [status, setStatus] = useState<EventStatus | ''>('');
  const list = useCursorList((cursor) => api.events.list({ status: status || undefined, cursor, limit: PAGE_SIZE }), [api, status, refresh]);
  const [deciding, setDeciding] = useState<{ event: AdminEventRow; decision: Decision } | null>(null);
  const [checkingIn, setCheckingIn] = useState<AdminEventRow | null>(null);
  const [editing, setEditing] = useState<AdminEventRow | null>(null);
  const [viewing, setViewing] = useState<AdminEventRow | null>(null);

  return (
    <>
      <div className="filters">
        <SelectField
          label={t('events.filters.status')}
          value={status}
          onChange={(v) => setStatus(v as EventStatus | '')}
          options={EVENT_STATUSES.map((s) => ({ value: s, label: statusLabel(s) }))}
          placeholder={t('common.all')}
        />
      </div>
      {list.status === 'loading' ? <LoadingState /> : null}
      {list.status === 'error' ? <ErrorState error={list.error} onRetry={list.reload} /> : null}
      {list.status === 'ready' && list.items.length === 0 ? <EmptyState message={status ? t('events.emptyFiltered') : t('events.empty')} /> : null}
      {list.status === 'ready' && list.items.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('events.columns.title')}</th>
                <th scope="col">{t('common.status')}</th>
                <th scope="col">{t('events.columns.schedule')}</th>
                <th scope="col">{t('events.columns.city')}</th>
                <th scope="col">{t('events.columns.organizer')}</th>
                <th scope="col" className="num">{t('events.columns.attendance')}</th>
                <th scope="col" className="num">{t('events.columns.waitlist')}</th>
                <th scope="col" className="num">{t('events.columns.checkedIn')}</th>
                <th scope="col">{t('events.columns.price')}</th>
                <th scope="col">{t('events.columns.note')}</th>
                <th scope="col"><span className="visually-hidden">{t('common.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((e) => (
                <tr key={e.id} className={e.status === 'pending_review' ? 'is-warning' : undefined}>
                  <td dir="auto">{e.title}</td>
                  <td><EventStatusBadge status={e.status} /></td>
                  <td>
                    <time dateTime={e.starts_at}>{formatDateTime(e.starts_at)}</time>
                    <div className="muted">{t('events.until', { at: formatDateTime(e.ends_at) })}</div>
                  </td>
                  <td>{`${e.city}, ${e.country_code}`}</td>
                  <td>{organizerLabel(e.organizer_type)}</td>
                  <td className="num">{attendanceLabel(e)}</td>
                  <td className="num">{formatNumber(e.waitlist_count)}</td>
                  <td className="num">{formatNumber(e.checked_in_count)}</td>
                  <td>{priceLabel(e)}</td>
                  <td className="pre-wrap">{e.moderation_note ?? '—'}</td>
                  <td className="table__actions">
                    <Button size="sm" variant="ghost" onClick={() => setViewing(e)} aria-label={`${t('events.detail.action')} ${e.title}`}>{t('events.detail.action')}</Button>
                    {canManage && editable(e.status) ? (
                      <Button size="sm" variant="ghost" onClick={() => setEditing(e)} aria-label={`${t('events.edit.action')} ${e.title}`}>{t('events.edit.action')}</Button>
                    ) : null}
                    {canManage ? allowedDecisions(e.status).map((d) => (
                      <Button
                        key={d}
                        size="sm"
                        variant={d === 'publish' ? 'primary' : d === 'cancel' ? 'danger' : 'secondary'}
                        onClick={() => setDeciding({ event: e, decision: d })}
                        aria-label={`${t(`events.decision.${d}.action`)} ${e.title}`}
                      >
                        {t(`events.decision.${d}.action`)}
                      </Button>
                    )) : null}
                    {canManage && e.status === 'published' ? (
                      <Button size="sm" variant="ghost" onClick={() => setCheckingIn(e)} aria-label={`${t('events.checkIn.action')} ${e.title}`}>{t('events.checkIn.action')}</Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <LoadMore list={list} />
        </div>
      ) : null}
      {deciding ? <DecisionDialog event={deciding.event} decision={deciding.decision} onClose={() => setDeciding(null)} onDone={list.reload} /> : null}
      {checkingIn ? <CheckInDialog event={checkingIn} onClose={() => setCheckingIn(null)} onDone={list.reload} /> : null}
      {viewing ? (
        <EventDetailDialog
          event={viewing}
          canManage={canManage}
          onClose={() => setViewing(null)}
          onEdit={canManage && editable(viewing.status) ? () => { setEditing(viewing); setViewing(null); } : undefined}
          onChanged={list.reload}
        />
      ) : null}
      {editing ? <EditEventDialog event={editing} onClose={() => setEditing(null)} onSaved={list.reload} /> : null}
    </>
  );
}
