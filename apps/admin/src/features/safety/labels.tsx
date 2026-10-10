import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { t, tDynamic } from '@/i18n';
import type { CaseStatus, Severity } from '@/lib/api/modules/safety';

/** Localized label for an API enum value; unknown values fall back to the raw value. */
export const label = (group: string, value: string | null | undefined): string => (value ? tDynamic(`safety.${group}.${value}`, value) : '—');

const SEVERITY_TONE: Record<Severity, BadgeTone> = { low: 'neutral', medium: 'info', high: 'warning', critical: 'danger' };
const STATUS_TONE: Record<CaseStatus, BadgeTone> = { open: 'info', in_review: 'info', escalated: 'warning', actioned: 'success', dismissed: 'neutral', closed: 'neutral' };

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <Badge tone={SEVERITY_TONE[severity] ?? 'neutral'}>{label('severity', severity)}</Badge>;
}

export function CaseStatusBadge({ status }: { status: CaseStatus }) {
  return <Badge tone={STATUS_TONE[status] ?? 'neutral'}>{label('caseStatus', status)}</Badge>;
}

/** Assignment cell: "you" for the signed-in admin, otherwise the admin id (the API returns ids only). */
export function assigneeLabel(assignedTo: string | null, myId: string | undefined): string {
  if (!assignedTo) return t('safety.cases.unassigned');
  return assignedTo === myId ? t('safety.cases.you') : assignedTo;
}

/** Options for a select bound to an enum, labelled through `safety.<group>.*`. */
export const enumOptions = (group: string, values: readonly string[]) => values.map((v) => ({ value: v, label: label(group, v) }));
