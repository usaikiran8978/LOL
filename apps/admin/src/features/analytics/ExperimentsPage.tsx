'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui/states';
import { t } from '@/i18n';
import type { AdminApi } from '@/lib/api/admin-api';
import type { ExperimentRow } from '@/lib/api/modules/analytics';
import { useAdminApi, useSession } from '@/lib/auth/session';
import { formatDateTime, formatPercent } from '@/lib/format';
import { useResource } from '@/lib/hooks/useResource';
import { AnalyticsTabs } from './AnalyticsTabs';
import { ExperimentDialog, type SegmentRef } from './ExperimentDialog';
import { ExperimentStatusBadge, ExperimentTransitions } from './ExperimentTransitions';

/**
 * Experiments plus (for admins who may list segments: flags.manage) the segment id→key map the editor needs.
 * A failed segment lookup degrades to a free-text segment field instead of failing the page.
 */
export async function loadExperiments(api: AdminApi, canListSegments: boolean): Promise<{ experiments: ExperimentRow[]; segments: SegmentRef[] | null }> {
  const [experiments, segments] = await Promise.all([
    api.analytics.experiments(),
    canListSegments ? api.config.segments().then((s) => s.map(({ id, key }) => ({ id, key })), () => null) : Promise.resolve(null),
  ]);
  return { experiments, segments };
}

export const experimentHref = (key: string) => `/experiments/${encodeURIComponent(key)}`;

export function ExperimentsPage() {
  const api = useAdminApi();
  const { can } = useSession();
  const canManage = can('experiments.manage');
  const canSegments = can('flags.manage');
  const data = useResource(() => loadExperiments(api, canManage && canSegments), [api, canManage, canSegments]);
  const [editing, setEditing] = useState<ExperimentRow | 'new' | null>(null);

  return (
    <>
      <PageHeader
        title={t('analytics.experiments.title')}
        intro={t('analytics.experiments.intro')}
        actions={canManage ? <Button onClick={() => setEditing('new')} disabled={data.status !== 'success'}>{t('analytics.experiments.newExperiment')}</Button> : undefined}
      />
      <AnalyticsTabs />
      {data.status === 'loading' ? <LoadingState /> : null}
      {data.status === 'error' ? <ErrorState error={data.error} onRetry={data.reload} /> : null}
      {data.status === 'success' && data.data.experiments.length === 0 ? <EmptyState message={t('analytics.experiments.empty')} /> : null}
      {data.status === 'success' && data.data.experiments.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('analytics.experiments.key')}</th>
                <th scope="col">{t('analytics.experiments.surface')}</th>
                <th scope="col">{t('analytics.experiments.status')}</th>
                <th scope="col" className="num">{t('analytics.experiments.traffic')}</th>
                <th scope="col">{t('analytics.experiments.primaryMetric')}</th>
                <th scope="col">{t('analytics.experiments.variants')}</th>
                <th scope="col">{t('analytics.experiments.started')}</th>
                <th scope="col">{t('analytics.experiments.ended')}</th>
                <th scope="col"><span className="visually-hidden">{t('common.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {data.data.experiments.map((e) => (
                <tr key={e.id}>
                  <td><Link href={experimentHref(e.key)}><code>{e.key}</code></Link></td>
                  <td>{t(`analytics.experiments.surfaces.${e.surface}`)}</td>
                  <td><ExperimentStatusBadge status={e.status} /></td>
                  <td className="num">{formatPercent(e.traffic_pct / 100, 0)}</td>
                  <td><code>{e.primary_metric}</code></td>
                  <td>{e.variants.map((v) => `${v.key} (${formatPercent(v.allocation / 100, 0)})`).join(', ')}</td>
                  <td>{formatDateTime(e.started_at)}</td>
                  <td>{formatDateTime(e.ended_at)}</td>
                  <td className="table__actions">
                    <Link className="btn btn--ghost btn--sm" href={experimentHref(e.key)} aria-label={t('analytics.experiments.viewResultsFor', { key: e.key })}>
                      {t('analytics.experiments.viewResults')}
                    </Link>
                    {canManage && e.status === 'draft' ? (
                      <Button variant="ghost" size="sm" onClick={() => setEditing(e)} aria-label={`${t('common.edit')} ${e.key}`}>{t('common.edit')}</Button>
                    ) : null}
                    <ExperimentTransitions experimentKey={e.key} status={e.status} onDone={data.reload} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {editing && data.status === 'success' ? (
        <ExperimentDialog experiment={editing === 'new' ? null : editing} segments={data.data.segments} onClose={() => setEditing(null)} onSaved={data.reload} />
      ) : null}
    </>
  );
}
