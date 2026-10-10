'use client';

import { adminCaseQuery } from '@amora/shared';
import Link from 'next/link';
import { useState } from 'react';
import { RequirePermission } from '@/components/shell/RouteGuard';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { SelectField, TextField } from '@/components/ui/fields';
import { LoadMore } from '@/components/ui/LoadMore';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui/states';
import { t } from '@/i18n';
import { CASE_CATEGORIES, CASE_STATUSES, SEVERITIES, type CaseQuery } from '@/lib/api/modules/safety';
import { useSession } from '@/lib/auth/session';
import { formatDateTime, formatNumber } from '@/lib/format';
import { validate, type FieldErrors } from '@/lib/forms/validate';
import { useCursorList } from '@/lib/hooks/useCursorList';
import { CreateCaseDialog } from './CreateCaseDialog';
import { assigneeLabel, CaseStatusBadge, enumOptions, label, SeverityBadge } from './labels';
import { ModerationTabs } from './ModerationTabs';

type Filters = { status: string; severity: string; category: string; assigned: string; assignedId: string; subjectUserId: string };
const EMPTY: Filters = { status: '', severity: '', category: '', assigned: '', assignedId: '', subjectUserId: '' };
const PAGE_SIZE = 25;

function toQuery(f: Filters): Record<string, string | undefined> {
  const assignedTo = f.assigned === 'other' ? f.assignedId.trim() || undefined : f.assigned || undefined;
  return {
    status: f.status || undefined,
    severity: f.severity || undefined,
    category: f.category || undefined,
    assignedTo,
    subjectUserId: f.subjectUserId.trim() || undefined,
  };
}

export function CasesPage() {
  const { admin } = useSession();
  return (
    <RequirePermission permission="moderation.view" permissions={admin?.permissions ?? []}>
      <CasesQueue />
    </RequirePermission>
  );
}

function CasesQueue() {
  const { api, admin, can } = useSession();
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [applied, setApplied] = useState<CaseQuery>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const [creating, setCreating] = useState(false);
  const list = useCursorList((cursor) => api.safety.cases({ ...applied, cursor, limit: PAGE_SIZE }), [api, applied]);

  function apply() {
    const v = validate(adminCaseQuery, toQuery(draft));
    if (!v.ok) {
      // The assignee id is entered in its own field.
      const { assignedTo, ...rest } = v.errors;
      return setErrors(assignedTo ? { ...rest, assignedId: assignedTo } : rest);
    }
    setErrors({});
    setApplied(v.data);
  }

  function reset() {
    setDraft(EMPTY);
    setErrors({});
    setApplied({});
  }

  const set = (k: keyof Filters) => (v: string) => setDraft((d) => ({ ...d, [k]: v }));

  return (
    <>
      <PageHeader
        title={t('safety.cases.title')}
        intro={t('safety.cases.intro')}
        actions={can('moderation.action') ? <Button onClick={() => setCreating(true)}>{t('safety.create.open')}</Button> : null}
      />
      <ModerationTabs />
      <form className="filters" aria-label={t('safety.cases.filters')} noValidate onSubmit={(e) => { e.preventDefault(); apply(); }}>
        <SelectField label={t('safety.cases.status')} hint={t('safety.cases.statusHint')} value={draft.status} onChange={set('status')} placeholder={t('safety.cases.activeStatuses')} options={enumOptions('caseStatus', CASE_STATUSES)} className="field--inline" />
        <SelectField label={t('safety.cases.severity')} value={draft.severity} onChange={set('severity')} placeholder={t('common.all')} options={enumOptions('severity', SEVERITIES)} className="field--inline" />
        <SelectField label={t('safety.cases.category')} value={draft.category} onChange={set('category')} placeholder={t('common.all')} options={enumOptions('category', CASE_CATEGORIES)} className="field--inline" />
        <SelectField
          label={t('safety.cases.assignedTo')}
          value={draft.assigned}
          onChange={set('assigned')}
          placeholder={t('common.all')}
          options={[
            { value: 'me', label: t('safety.cases.assignedMe') },
            { value: 'unassigned', label: t('safety.cases.unassigned') },
            { value: 'other', label: t('safety.cases.assignedOther') },
          ]}
          className="field--inline"
        />
        {draft.assigned === 'other' ? (
          <TextField label={t('safety.cases.assigneeId')} value={draft.assignedId} onChange={set('assignedId')} error={errors.assignedId} className="field--inline" spellCheck={false} />
        ) : null}
        <TextField label={t('safety.cases.subjectUserId')} value={draft.subjectUserId} onChange={set('subjectUserId')} error={errors.subjectUserId} className="field--inline" spellCheck={false} />
        <div className="row">
          <button type="submit" className="btn btn--primary btn--md">{t('common.apply')}</button>
          <Button variant="secondary" onClick={reset}>{t('common.reset')}</Button>
        </div>
      </form>
      <p className="muted">{t('safety.cases.reportsNote')}</p>

      {list.status === 'loading' ? <LoadingState /> : null}
      {list.status === 'error' ? <ErrorState error={list.error} onRetry={list.reload} /> : null}
      {list.status === 'ready' && list.items.length === 0 ? <EmptyState message={t('safety.cases.empty')} /> : null}
      {list.status === 'ready' && list.items.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <caption className="table__caption">{t('safety.cases.caption')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('safety.cases.subject')}</th>
                <th scope="col">{t('safety.cases.category')}</th>
                <th scope="col">{t('safety.cases.severity')}</th>
                <th scope="col" className="num">{t('safety.cases.priority')}</th>
                <th scope="col">{t('safety.cases.status')}</th>
                <th scope="col">{t('safety.cases.source')}</th>
                <th scope="col" className="num">{t('safety.cases.reports')}</th>
                <th scope="col">{t('safety.cases.assignee')}</th>
                <th scope="col">{t('safety.cases.slaDue')}</th>
                <th scope="col">{t('safety.cases.opened')}</th>
                <th scope="col"><span className="visually-hidden">{t('common.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((c) => (
                <tr key={c.id} className={c.sla_breached ? 'is-danger' : c.severity === 'critical' ? 'is-warning' : undefined}>
                  <td>
                    {c.display_name ?? t('safety.cases.noSubject')}
                    <br />
                    <code className="muted">{c.subject_user_id ?? '—'}</code>
                    {c.subject_status ? <div className="muted">{label('userStatus', c.subject_status)}{c.country_code ? ` · ${c.country_code}` : ''}</div> : null}
                  </td>
                  <td>{label('category', c.category)}</td>
                  <td><SeverityBadge severity={c.severity} /></td>
                  <td className="num">{formatNumber(Number(c.priority_score))}</td>
                  <td><CaseStatusBadge status={c.status} /></td>
                  <td>{label('source', c.source)}</td>
                  <td className="num">{formatNumber(c.report_count)}</td>
                  <td>{c.assigned_to ? <code>{assigneeLabel(c.assigned_to, admin?.id)}</code> : assigneeLabel(null, admin?.id)}</td>
                  <td>
                    <time dateTime={c.sla_due_at}>{formatDateTime(c.sla_due_at)}</time>
                    {c.sla_breached ? <> <Badge tone="danger">{t('safety.cases.slaBreached')}</Badge></> : null}
                  </td>
                  <td><time dateTime={c.opened_at}>{formatDateTime(c.opened_at)}</time></td>
                  <td className="table__actions">
                    <Link href={`/moderation/cases/${c.id}`} className="btn btn--ghost btn--sm" aria-label={`${t('safety.cases.open')} ${c.display_name ?? c.id}`}>{t('safety.cases.open')}</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <LoadMore list={list} />
        </div>
      ) : null}
      {creating ? <CreateCaseDialog onClose={() => setCreating(false)} /> : null}
    </>
  );
}
