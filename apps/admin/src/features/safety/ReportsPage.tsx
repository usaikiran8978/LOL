'use client';

import Link from 'next/link';
import { useState } from 'react';
import { z } from 'zod';
import { RequirePermission } from '@/components/shell/RouteGuard';
import { Button } from '@/components/ui/Button';
import { SelectField, TextField } from '@/components/ui/fields';
import { LoadMore } from '@/components/ui/LoadMore';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui/states';
import { t } from '@/i18n';
import { REPORT_STATUSES, type ReportQuery, type ReportStatus } from '@/lib/api/modules/safety';
import { useSession } from '@/lib/auth/session';
import { formatDateTime } from '@/lib/format';
import { validate, type FieldErrors } from '@/lib/forms/validate';
import { useCursorList } from '@/lib/hooks/useCursorList';
import { enumOptions, label } from './labels';
import { ModerationTabs } from './ModerationTabs';

/** Mirrors the query schema of `GET admin/moderation/reports` (inline in safety-admin.controller.ts). */
const reportFilters = z.object({
  status: z.enum(REPORT_STATUSES).optional(),
  reasonKey: z.string().max(50).optional(),
  reportedUserId: z.uuid().optional(),
});

type Filters = { status: string; reasonKey: string; reportedUserId: string };
const EMPTY: Filters = { status: '', reasonKey: '', reportedUserId: '' };
const PAGE_SIZE = 50;

export function ReportsPage() {
  const { admin } = useSession();
  return (
    <RequirePermission permission="moderation.view" permissions={admin?.permissions ?? []}>
      <ReportsList />
    </RequirePermission>
  );
}

function ReportsList() {
  const { api, can } = useSession();
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [applied, setApplied] = useState<ReportQuery>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const list = useCursorList((cursor) => api.safety.reports({ ...applied, cursor, limit: PAGE_SIZE }), [api, applied]);
  const pii = can('users.view_pii');
  const canUsers = can('users.view');

  function apply() {
    const v = validate(reportFilters, {
      status: (draft.status || undefined) as ReportStatus | undefined,
      reasonKey: draft.reasonKey.trim() || undefined,
      reportedUserId: draft.reportedUserId.trim() || undefined,
    });
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    setApplied(v.data);
  }

  function reset() {
    setDraft(EMPTY);
    setErrors({});
    setApplied({});
  }

  const set = (k: keyof Filters) => (v: string) => setDraft((d) => ({ ...d, [k]: v }));
  const userCell = (id: string | null) => {
    if (!id) return '—';
    return canUsers ? <Link href={`/users/${encodeURIComponent(id)}`}><code>{id}</code></Link> : <code>{id}</code>;
  };

  return (
    <>
      <PageHeader title={t('safety.reports.title')} intro={t('safety.reports.intro')} />
      <ModerationTabs />
      <form className="filters" aria-label={t('safety.reports.filters')} noValidate onSubmit={(e) => { e.preventDefault(); apply(); }}>
        <SelectField label={t('safety.reports.status')} value={draft.status} onChange={set('status')} placeholder={t('common.all')} options={enumOptions('reportStatus', REPORT_STATUSES)} className="field--inline" />
        <TextField label={t('safety.reports.reasonKey')} hint={t('safety.reports.reasonKeyHint')} value={draft.reasonKey} onChange={set('reasonKey')} error={errors.reasonKey} maxLength={50} spellCheck={false} className="field--inline" />
        <TextField label={t('safety.reports.reportedUserId')} value={draft.reportedUserId} onChange={set('reportedUserId')} error={errors.reportedUserId} spellCheck={false} className="field--inline" />
        <div className="row">
          <button type="submit" className="btn btn--primary btn--md">{t('common.apply')}</button>
          <Button variant="secondary" onClick={reset}>{t('common.reset')}</Button>
        </div>
      </form>
      {!pii ? <p className="muted">{t('safety.reports.reporterHiddenHint')}</p> : null}

      {list.status === 'loading' ? <LoadingState /> : null}
      {list.status === 'error' ? <ErrorState error={list.error} onRetry={list.reload} /> : null}
      {list.status === 'ready' && list.items.length === 0 ? <EmptyState message={t('safety.reports.empty')} /> : null}
      {list.status === 'ready' && list.items.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <caption className="table__caption">{t('safety.reports.caption')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('safety.reports.created')}</th>
                <th scope="col">{t('safety.reports.reported')}</th>
                <th scope="col">{t('safety.reports.reporter')}</th>
                <th scope="col">{t('safety.reports.target')}</th>
                <th scope="col">{t('safety.reports.reason')}</th>
                <th scope="col">{t('safety.reports.details')}</th>
                <th scope="col">{t('safety.reports.status')}</th>
                <th scope="col">{t('safety.reports.case')}</th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((r) => (
                <tr key={r.id}>
                  <td><time dateTime={r.created_at}>{formatDateTime(r.created_at)}</time></td>
                  <td>
                    {userCell(r.reported_user_id)}
                    {r.country_code ? <div className="muted">{r.country_code}</div> : null}
                  </td>
                  <td>{r.reporter_id ? userCell(r.reporter_id) : <span className="muted">{t('safety.reports.reporterHidden')}</span>}</td>
                  <td>{label('targetType', r.target_type)}{r.target_id ? <div><code className="muted">{r.target_id}</code></div> : null}</td>
                  <td>{r.reason_key ? <code>{r.reason_key}</code> : '—'}</td>
                  <td className="pre-wrap" dir="auto">{r.details ?? '—'}</td>
                  <td>{label('reportStatus', r.status)}</td>
                  <td>
                    {r.case_id
                      ? <Link href={`/moderation/cases/${encodeURIComponent(r.case_id)}`} aria-label={`${t('safety.reports.openCase')} ${r.case_id}`}>{t('safety.reports.openCase')}</Link>
                      : <span className="muted">{t('safety.reports.noCase')}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <LoadMore list={list} />
        </div>
      ) : null}
    </>
  );
}
