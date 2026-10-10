import { tDynamic } from '@/i18n';
import type { DsarRequest, DsarStatus } from '@/lib/api/modules/privacy';

export const OPEN_STATUSES: DsarStatus[] = ['received', 'verifying', 'in_progress'];
const DUE_SOON_MS = 7 * 86_400_000;

export const kindLabel = (k: string) => tDynamic(`privacy.requests.kinds.${k}`, k);
export const statusLabel = (s: string) => tDynamic(`privacy.requests.statuses.${s}`, s);

/** Urgency of an open request relative to its legal due date (conveyed by row class AND a text badge). */
export function urgency(r: Pick<DsarRequest, 'status' | 'due_at'>, now = Date.now()): 'overdue' | 'dueSoon' | null {
  if (!OPEN_STATUSES.includes(r.status)) return null;
  const due = new Date(r.due_at).getTime();
  if (due < now) return 'overdue';
  if (due - now <= DUE_SOON_MS) return 'dueSoon';
  return null;
}
