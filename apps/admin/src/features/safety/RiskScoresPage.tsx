'use client';

import Link from 'next/link';
import { useState } from 'react';
import { z } from 'zod';
import { RequirePermission } from '@/components/shell/RouteGuard';
import { NumberField } from '@/components/ui/fields';
import { LoadMore } from '@/components/ui/LoadMore';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui/states';
import { t } from '@/i18n';
import { useSession } from '@/lib/auth/session';
import { formatDateTime, formatNumber, formatPercent } from '@/lib/format';
import { validate } from '@/lib/forms/validate';
import { useCursorList } from '@/lib/hooks/useCursorList';
import { label } from './labels';
import { ModerationTabs } from './ModerationTabs';

/** Mirrors the `minScore` query of `GET admin/moderation/risk-scores` (API default 0.5). */
const minScoreSchema = z.number().min(0).max(1);
const DEFAULT_MIN = 0.5;
const PAGE_SIZE = 50;

export function RiskScoresPage() {
  const { admin } = useSession();
  return (
    <RequirePermission permission="moderation.view" permissions={admin?.permissions ?? []}>
      <RiskList />
    </RequirePermission>
  );
}

function RiskList() {
  const { api, can } = useSession();
  const [draft, setDraft] = useState<number | undefined>(DEFAULT_MIN);
  const [minScore, setMinScore] = useState(DEFAULT_MIN);
  const [error, setError] = useState<string | undefined>();
  const list = useCursorList((cursor) => api.safety.riskScores({ minScore, cursor, limit: PAGE_SIZE }), [api, minScore]);
  const canUsers = can('users.view');

  function apply() {
    const v = validate(minScoreSchema, draft);
    if (!v.ok) return setError(v.errors['']);
    setError(undefined);
    setMinScore(v.data);
  }

  return (
    <>
      <PageHeader title={t('safety.riskScores.title')} intro={t('safety.riskScores.intro')} />
      <ModerationTabs />
      <form className="filters" noValidate onSubmit={(e) => { e.preventDefault(); apply(); }}>
        <NumberField label={t('safety.riskScores.minScore')} hint={t('safety.riskScores.minScoreHint')} value={draft} onChange={setDraft} error={error} min={0} max={1} step={0.05} className="field--inline" />
        <div className="row">
          <button type="submit" className="btn btn--primary btn--md">{t('common.apply')}</button>
        </div>
      </form>
      <p className="muted">{t('safety.thresholds.riskModel')}</p>

      {list.status === 'loading' ? <LoadingState /> : null}
      {list.status === 'error' ? <ErrorState error={list.error} onRetry={list.reload} /> : null}
      {list.status === 'ready' && list.items.length === 0 ? <EmptyState message={t('safety.riskScores.empty')} /> : null}
      {list.status === 'ready' && list.items.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <caption className="table__caption">{t('safety.riskScores.caption')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('safety.riskScores.user')}</th>
                <th scope="col" className="num">{t('safety.riskScores.score')}</th>
                <th scope="col" className="num">{t('safety.riskScores.reporters')}</th>
                <th scope="col">{t('safety.riskScores.signals')}</th>
                <th scope="col">{t('safety.riskScores.computedAt')}</th>
                <th scope="col"><span className="visually-hidden">{t('common.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((r) => {
                const score = Number(r.score);
                const signals = Object.entries(r.components?.signals ?? {});
                return (
                  <tr key={r.user_id} className={score >= 0.8 ? 'is-danger' : undefined}>
                    <td>
                      {r.display_name ?? '—'}
                      <br />
                      <code className="muted">{r.user_id}</code>
                      <div className="muted">{label('userStatus', r.status)}{r.country_code ? ` · ${r.country_code}` : ''}</div>
                    </td>
                    <td className="num"><strong>{formatPercent(score)}</strong></td>
                    <td className="num">{formatNumber(r.components?.reporters ?? 0)}</td>
                    <td>
                      {signals.length ? (
                        <ul className="safety-evidence">
                          {signals.map(([k, n]) => <li key={k}>{`${label('signal', k)} × ${formatNumber(n)}`}</li>)}
                        </ul>
                      ) : '—'}
                    </td>
                    <td><time dateTime={r.computed_at}>{formatDateTime(r.computed_at)}</time></td>
                    <td className="table__actions">
                      {canUsers ? (
                        <Link href={`/users/${encodeURIComponent(r.user_id)}`} className="btn btn--ghost btn--sm" aria-label={`${t('safety.riskScores.openUser')} ${r.display_name ?? r.user_id}`}>{t('safety.riskScores.openUser')}</Link>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <LoadMore list={list} />
        </div>
      ) : null}
    </>
  );
}
