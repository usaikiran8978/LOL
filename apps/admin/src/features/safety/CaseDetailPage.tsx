'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useNotify } from '@/components/shell/notice';
import { RequirePermission } from '@/components/shell/RouteGuard';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DefinitionList } from '@/components/ui/DefinitionList';
import { ErrorState, FormError, LoadingState, PageHeader } from '@/components/ui/states';
import { t } from '@/i18n';
import { errorMessage, requestIdOf } from '@/lib/api/errors';
import type { CaseDetail } from '@/lib/api/modules/safety';
import { useSession } from '@/lib/auth/session';
import { formatDateTime, formatNumber } from '@/lib/format';
import { useResource } from '@/lib/hooks/useResource';
import { CaseActionDialog } from './CaseActionDialog';
import { CaseActionsHistory } from './CaseActionsHistory';
import { CaseContext } from './CaseContext';
import { CaseEvidenceSection, CaseReportsSection } from './CaseEvidence';
import { CaseNotes } from './CaseNotes';
import { CaseUpdateDialog } from './CaseUpdateDialog';
import { assigneeLabel, CaseStatusBadge, label, SeverityBadge } from './labels';
import { ModerationTabs } from './ModerationTabs';

const ACTIVE = ['open', 'in_review', 'escalated'];

export function CaseDetailPage({ caseId }: { caseId: string }) {
  const { admin } = useSession();
  return (
    <RequirePermission permission="moderation.view" permissions={admin?.permissions ?? []}>
      <CaseDetailView caseId={caseId} />
    </RequirePermission>
  );
}

function CaseDetailView({ caseId }: { caseId: string }) {
  const { api } = useSession();
  const data = useResource(() => api.safety.case(caseId), [api, caseId]);

  return (
    <>
      <p><Link href="/moderation/cases">{t('safety.detail.back')}</Link></p>
      {data.status === 'loading' ? <LoadingState /> : null}
      {data.status === 'error' ? <ErrorState error={data.error} onRetry={data.reload} /> : null}
      {data.status === 'success' ? <CaseView c={data.data} reload={data.reload} /> : null}
    </>
  );
}

function CaseView({ c, reload }: { c: CaseDetail; reload: () => void }) {
  const { api, admin, can } = useSession();
  const notify = useNotify();
  const [dialog, setDialog] = useState<'update' | 'action' | null>(null);
  const [assignBusy, setAssignBusy] = useState(false);
  const [assignError, setAssignError] = useState<unknown>(null);
  const active = ACTIVE.includes(c.status);
  const mine = c.assigned_to !== null && c.assigned_to === admin?.id;

  async function assignToMe() {
    setAssignBusy(true);
    setAssignError(null);
    try {
      await api.safety.updateCase(c.id, { assignTo: 'me' });
      notify(t('safety.detail.assigned'));
      reload();
    } catch (e) {
      setAssignError(e);
    } finally {
      setAssignBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title={t('safety.detail.title', { category: label('category', c.category) })}
        intro={c.profile?.display_name ?? c.subject_user_id ?? t('safety.cases.noSubject')}
        actions={
          <>
            {active && !mine ? <Button variant="secondary" onClick={() => void assignToMe()} disabled={assignBusy}>{t('safety.detail.assignToMe')}</Button> : null}
            <Button variant="secondary" onClick={() => setDialog('update')}>{t('safety.detail.update')}</Button>
            {can('moderation.action') && c.subject_user_id ? <Button onClick={() => setDialog('action')}>{t('safety.detail.takeAction')}</Button> : null}
          </>
        }
      />
      <ModerationTabs />
      {assignError ? <FormError message={errorMessage(assignError)} requestId={requestIdOf(assignError)} /> : null}
      {!c.subject_user_id ? <p className="alert alert--info">{t('safety.detail.noSubjectNote')}</p> : null}

      <section className="card" aria-labelledby="case-summary">
        <h2 id="case-summary" className="card__title">{t('safety.detail.summary')}</h2>
        <DefinitionList
          items={[
            { label: t('safety.cases.status'), value: <CaseStatusBadge status={c.status} /> },
            { label: t('safety.cases.severity'), value: <SeverityBadge severity={c.severity} /> },
            { label: t('safety.cases.priority'), value: formatNumber(Number(c.priority_score)) },
            { label: t('safety.cases.source'), value: label('source', c.source) },
            { label: t('safety.cases.assignee'), value: c.assigned_to ? <code>{assigneeLabel(c.assigned_to, admin?.id)}</code> : assigneeLabel(null, admin?.id) },
            { label: t('safety.detail.assignedAt'), value: formatDateTime(c.assigned_at) },
            {
              label: t('safety.cases.slaDue'),
              value: (
                <>
                  {formatDateTime(c.sla_due_at)}
                  {active && new Date(c.sla_due_at).getTime() < Date.now() ? <> <Badge tone="danger">{t('safety.cases.slaBreached')}</Badge></> : null}
                </>
              ),
            },
            { label: t('safety.cases.opened'), value: formatDateTime(c.opened_at) },
            { label: t('safety.detail.resolvedAt'), value: formatDateTime(c.resolved_at) },
            { label: t('safety.detail.resolution'), value: c.resolution_key ? <code>{c.resolution_key}</code> : '—' },
            { label: t('safety.cases.subjectUserId'), value: c.subject_user_id ? <code>{c.subject_user_id}</code> : '—' },
          ]}
        />
      </section>

      <CaseReportsSection reports={c.reports} />
      <CaseEvidenceSection evidence={c.evidence} />
      <CaseContext c={c} />
      <CaseActionsHistory actions={c.actions} onChanged={reload} />
      <CaseNotes caseId={c.id} notes={c.notes} onAdded={reload} />

      {dialog === 'update' ? <CaseUpdateDialog c={c} onClose={() => setDialog(null)} onSaved={reload} /> : null}
      {dialog === 'action' ? <CaseActionDialog c={c} onClose={() => setDialog(null)} onDone={reload} /> : null}
    </>
  );
}
