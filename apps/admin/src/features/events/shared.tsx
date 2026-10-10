import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { t } from '@/i18n';
import type { AdminEventRow, EventOrganizerType, EventStatus } from '@/lib/api/modules/events';
import { formatMoney, formatNumber } from '@/lib/format';

const STATUS_TONE: Record<EventStatus, BadgeTone> = {
  draft: 'neutral',
  pending_review: 'warning',
  published: 'success',
  cancelled: 'danger',
  completed: 'info',
  rejected: 'danger',
};

export const statusLabel = (s: EventStatus) => t(`events.status.${s}`);
export const organizerLabel = (o: EventOrganizerType) => t(`events.organizer.${o}`);

export function EventStatusBadge({ status }: { status: EventStatus }) {
  return <Badge tone={STATUS_TONE[status] ?? 'neutral'}>{statusLabel(status)}</Badge>;
}

/** "registered / capacity" (∞ when unlimited). */
export function attendanceLabel(e: Pick<AdminEventRow, 'registered_count' | 'capacity'>): string {
  return t('events.attendance', { registered: formatNumber(e.registered_count), capacity: e.capacity === null ? t('events.unlimited') : formatNumber(e.capacity) });
}

export function priceLabel(e: Pick<AdminEventRow, 'price_minor' | 'currency'>): string {
  const minor = Number(e.price_minor) || 0;
  return minor > 0 ? formatMoney(minor, e.currency) : t('events.free');
}

/** Edits are refused by the API once an event is cancelled or completed. */
export const editable = (status: EventStatus) => status !== 'cancelled' && status !== 'completed';

export type Decision = 'publish' | 'reject' | 'cancel';

/**
 * Decisions offered per status. Mirrors EventsService.adminDecide: publish is allowed from draft / pending_review /
 * rejected; reject is offered only for events awaiting review; cancel for anything not already over.
 */
export function allowedDecisions(status: EventStatus): Decision[] {
  const out: Decision[] = [];
  if (status === 'draft' || status === 'pending_review' || status === 'rejected') out.push('publish');
  if (status === 'draft' || status === 'pending_review') out.push('reject');
  if (status === 'draft' || status === 'pending_review' || status === 'published') out.push('cancel');
  return out;
}
