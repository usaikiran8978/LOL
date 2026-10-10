'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DefinitionList } from '@/components/ui/DefinitionList';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { t, tDynamic } from '@/i18n';
import type { AdminEventDetail, AdminEventRow, AttendeeStatus, RosterEntry } from '@/lib/api/modules/events';
import { useAdminApi, useSession } from '@/lib/auth/session';
import { formatDateTime, formatNumber } from '@/lib/format';
import { useResource } from '@/lib/hooks/useResource';
import { attendeeName, CheckInDialog } from './CheckInDialog';
import { attendanceLabel, EventStatusBadge, organizerLabel, priceLabel } from './shared';

const ATTENDEE_TONE: Record<AttendeeStatus, 'success' | 'info' | 'neutral'> = { checked_in: 'success', registered: 'info', waitlisted: 'neutral' };

/**
 * Event detail: summary from `GET admin/events/:id` (attendance counts from the list row) and the full roster from
 * `GET admin/events/:id/attendees`, with check-in from a row or by code alone.
 */
export function EventDetailDialog({ event, canManage, onClose, onEdit, onChanged }: {
  event: AdminEventRow; canManage: boolean; onClose: () => void; onEdit?: () => void; onChanged: () => void;
}) {
  const api = useAdminApi();
  const { can } = useSession();
  const detail = useResource(() => api.events.detail(event.id), [api, event.id]);
  const roster = useResource(() => api.events.attendees(event.id), [api, event.id]);
  const [checkingIn, setCheckingIn] = useState<{ attendee?: RosterEntry } | null>(null);
  const canCheckIn = canManage && event.status === 'published';

  function checkedIn() {
    roster.reload();
    onChanged();
  }

  return (
    <>
      <Dialog title={t('events.detail.title', { title: event.title })} onClose={onClose} size="lg">
        {detail.status === 'loading' ? <LoadingState /> : null}
        {detail.status === 'error' ? <ErrorState error={detail.error} onRetry={detail.reload} /> : null}
        {detail.status === 'success' ? <Summary event={event} detail={detail.data} /> : null}
        <div className="row">
          {onEdit ? <Button variant="secondary" onClick={onEdit}>{t('events.edit.action')}</Button> : null}
          {canCheckIn ? <Button onClick={() => setCheckingIn({})}>{t('events.checkIn.byCode')}</Button> : null}
        </div>

        <h3 className="card__title">{t('events.roster.title')}</h3>
        {roster.status === 'loading' ? <LoadingState /> : null}
        {roster.status === 'error' ? <ErrorState error={roster.error} onRetry={roster.reload} /> : null}
        {roster.status === 'success' && roster.data.length === 0 ? <EmptyState message={t('events.roster.empty')} /> : null}
        {roster.status === 'success' && roster.data.length > 0 ? (
          <div className="table-wrap">
            <table className="table">
              <caption className="visually-hidden">{t('events.roster.title')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('events.roster.attendee')}</th>
                  <th scope="col">{t('events.roster.verification')}</th>
                  <th scope="col">{t('common.status')}</th>
                  <th scope="col">{t('events.roster.registeredAt')}</th>
                  <th scope="col">{t('events.roster.checkedInAt')}</th>
                  {canCheckIn ? <th scope="col"><span className="visually-hidden">{t('common.actions')}</span></th> : null}
                </tr>
              </thead>
              <tbody>
                {roster.data.map((a) => (
                  <tr key={a.userId}>
                    <td>
                      <span dir="auto">{a.displayName ?? '—'}</span>
                      <br />
                      {can('users.view') ? <Link href={`/users/${encodeURIComponent(a.userId)}`}><code className="muted">{a.userId}</code></Link> : <code className="muted">{a.userId}</code>}
                    </td>
                    <td>{a.verificationLevel ? tDynamic(`safety.verificationLevel.${a.verificationLevel}`, a.verificationLevel) : '—'}</td>
                    <td><Badge tone={ATTENDEE_TONE[a.status] ?? 'neutral'}>{t(`events.roster.status.${a.status}`)}</Badge></td>
                    <td>{formatDateTime(a.registeredAt)}</td>
                    <td>{formatDateTime(a.checkedInAt)}</td>
                    {canCheckIn ? (
                      <td className="table__actions">
                        {a.status === 'registered' ? (
                          <Button size="sm" variant="ghost" onClick={() => setCheckingIn({ attendee: a })} aria-label={`${t('events.checkIn.action')} ${attendeeName(a)}`}>{t('events.checkIn.action')}</Button>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Dialog>
      {checkingIn ? <CheckInDialog event={event} attendee={checkingIn.attendee} onClose={() => setCheckingIn(null)} onDone={checkedIn} /> : null}
    </>
  );
}

function Summary({ event, detail: d }: { event: AdminEventRow; detail: AdminEventDetail }) {
  const yesNo = (v: boolean) => (v ? t('common.yes') : t('common.no'));
  const venue = [d.venue_name, d.venue_address].filter(Boolean).join(', ');
  const coords = d.latitude !== null && d.longitude !== null ? `${formatNumber(Number(d.latitude), 5)}, ${formatNumber(Number(d.longitude), 5)}` : null;
  const ages = d.min_age === null && d.max_age === null
    ? t('events.detail.anyAge')
    : t('events.detail.ageRange', { min: d.min_age ?? 18, max: d.max_age ?? '—' });
  return (
    <DefinitionList
      items={[
        { label: t('common.status'), value: <EventStatusBadge status={d.status} /> },
        { label: t('events.detail.description'), value: <span className="pre-wrap" dir="auto">{d.description}</span> },
        { label: t('events.detail.category'), value: d.category_key ? <code>{d.category_key}</code> : '—' },
        { label: t('events.columns.startsAt'), value: formatDateTime(d.starts_at) },
        { label: t('events.columns.endsAt'), value: formatDateTime(d.ends_at) },
        { label: t('events.detail.timezone'), value: d.timezone },
        { label: t('events.columns.city'), value: `${d.city}, ${d.country_code}` },
        { label: t('events.detail.venue'), value: venue ? <span dir="auto">{venue}</span> : '—' },
        { label: t('events.detail.online'), value: yesNo(d.is_online) },
        coords ? { label: t('events.detail.coordinates'), value: coords } : null,
        { label: t('events.columns.organizer'), value: organizerLabel(d.organizer_type) },
        { label: t('events.form.visibility'), value: t(`events.visibility.${d.visibility}`) },
        { label: t('events.detail.ages'), value: ages },
        { label: t('events.form.preEventMatching'), value: yesNo(d.pre_event_matching) },
        { label: t('events.form.chatEnabled'), value: yesNo(d.chat_enabled) },
        { label: t('events.columns.attendance'), value: attendanceLabel({ registered_count: event.registered_count, capacity: d.capacity }) },
        { label: t('events.columns.waitlist'), value: formatNumber(event.waitlist_count) },
        { label: t('events.columns.checkedIn'), value: formatNumber(event.checked_in_count) },
        { label: t('events.columns.price'), value: priceLabel(d) },
        d.moderation_note ? { label: t('events.columns.note'), value: <span className="pre-wrap">{d.moderation_note}</span> } : null,
      ]}
    />
  );
}
