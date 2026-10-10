'use client';

import { adminUserSearch } from '@amora/shared';
import Link from 'next/link';
import { useState } from 'react';
import { useNotify } from '@/components/shell/notice';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { CheckboxField, SelectField, TextField } from '@/components/ui/fields';
import { LoadMore } from '@/components/ui/LoadMore';
import { EmptyState, ErrorState, FormError, LoadingState, PageHeader } from '@/components/ui/states';
import { t } from '@/i18n';
import { errorMessage, requestIdOf } from '@/lib/api/errors';
import type { UserSearchQuery } from '@/lib/api/modules/users';
import { useAdminApi, useSession } from '@/lib/auth/session';
import { downloadText } from '@/lib/download';
import { formatDate, formatDateTime } from '@/lib/format';
import { validate, type FieldErrors } from '@/lib/forms/validate';
import { useCursorList } from '@/lib/hooks/useCursorList';
import { statusLabel, statusTone, USER_STATUSES, verificationLabel } from './labels';

const PAGE_SIZE = 25;
const filterSchema = adminUserSearch.omit({ cursor: true, limit: true });

interface Draft { q: string; status: string; country: string; verified: boolean }
const EMPTY: Draft = { q: '', status: '', country: '', verified: false };
type Filters = Omit<UserSearchQuery, 'cursor' | 'limit'>;

export function UsersSearchPage() {
  const api = useAdminApi();
  const { can } = useSession();
  const notify = useNotify();
  const pii = can('users.view_pii');
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [applied, setApplied] = useState<Filters>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<unknown>(null);

  const list = useCursorList((cursor) => api.users.search({ ...applied, cursor, limit: PAGE_SIZE }), [api, applied]);

  function apply() {
    const v = validate(filterSchema, {
      q: draft.q.trim() || undefined,
      status: draft.status || undefined,
      country: draft.country.trim().toUpperCase() || undefined,
    });
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    setApplied({ q: v.data.q, status: v.data.status, country: v.data.country, verified: draft.verified || undefined });
  }

  function reset() {
    setDraft(EMPTY);
    setErrors({});
    setApplied({});
  }

  async function exportCsv() {
    setExporting(true);
    setExportError(null);
    try {
      const csv = await api.users.exportCsv(applied);
      downloadText(csv, `users-${new Date().toISOString().slice(0, 10)}.csv`);
      notify(t('users.exported'));
    } catch (e) {
      setExportError(e);
    } finally {
      setExporting(false);
    }
  }

  const set = <K extends keyof Draft>(k: K) => (v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  return (
    <>
      <PageHeader
        title={t('users.title')}
        intro={t('users.intro')}
        actions={can('users.export') ? (
          <Button variant="secondary" onClick={() => void exportCsv()} disabled={exporting} title={pii ? undefined : t('users.exportNoPii')}>
            {exporting ? t('users.exporting') : t('users.exportCsv')}
          </Button>
        ) : null}
      />
      {exportError ? <FormError message={errorMessage(exportError)} requestId={requestIdOf(exportError)} /> : null}
      <form className="filters" aria-label={t('users.filters')} noValidate onSubmit={(e) => { e.preventDefault(); apply(); }}>
        <TextField
          type="search"
          label={t('users.query')}
          hint={pii ? t('users.queryHintPii') : t('users.queryHint')}
          value={draft.q}
          onChange={set('q')}
          error={errors.q}
          className="field--inline"
          spellCheck={false}
          maxLength={200}
        />
        <SelectField
          label={t('users.status')}
          value={draft.status}
          onChange={set('status')}
          placeholder={t('common.all')}
          options={USER_STATUSES.map((s) => ({ value: s, label: statusLabel(s) }))}
          className="field--inline"
        />
        <TextField label={t('users.country')} hint={t('users.countryHint')} value={draft.country} onChange={set('country')} error={errors.country} className="field--inline" maxLength={2} />
        <CheckboxField label={t('users.verifiedOnly')} checked={draft.verified} onChange={set('verified')} />
        <div className="row">
          <button type="submit" className="btn btn--primary btn--md">{t('common.apply')}</button>
          <Button variant="secondary" onClick={reset}>{t('common.reset')}</Button>
        </div>
      </form>

      {list.status === 'loading' ? <LoadingState /> : null}
      {list.status === 'error' ? <ErrorState error={list.error} onRetry={list.reload} /> : null}
      {list.status === 'ready' && list.items.length === 0 ? <EmptyState message={t('users.empty')} /> : null}
      {list.status === 'ready' && list.items.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <caption className="visually-hidden">{t('users.resultsCaption')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('users.displayName')}</th>
                {pii ? <th scope="col">{t('users.email')}</th> : null}
                <th scope="col">{t('users.status')}</th>
                <th scope="col">{t('users.country')}</th>
                <th scope="col">{t('users.verification')}</th>
                <th scope="col">{t('users.createdAt')}</th>
                <th scope="col">{t('users.lastActive')}</th>
                <th scope="col"><span className="visually-hidden">{t('common.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((u) => (
                <tr key={u.id}>
                  <td>
                    {u.display_name ?? <span className="muted">{t('users.unnamed')}</span>}
                    <br />
                    <code className="muted">{u.id}</code>
                  </td>
                  {pii ? <td>{u.email ?? '—'}{u.phone_e164 ? <div className="muted">{u.phone_e164}</div> : null}</td> : null}
                  <td><Badge tone={statusTone(u.status)}>{statusLabel(u.status)}</Badge></td>
                  <td>{u.country_code ?? '—'}</td>
                  <td>{verificationLabel(u.verification_level)}</td>
                  <td>{formatDate(u.created_at)}</td>
                  <td>{formatDateTime(u.last_active_at)}</td>
                  <td className="table__actions">
                    <Link className="btn btn--ghost btn--sm" href={`/users/${encodeURIComponent(u.id)}`} aria-label={`${t('users.open')} ${u.display_name ?? u.id}`}>{t('users.open')}</Link>
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
