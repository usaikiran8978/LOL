'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { DefinitionList } from '@/components/ui/DefinitionList';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui/states';
import { t } from '@/i18n';
import { useAdminApi, useSession } from '@/lib/auth/session';
import { formatDateTime, formatPercent } from '@/lib/format';
import { useResource } from '@/lib/hooks/useResource';
import { AnalyticsTabs } from './AnalyticsTabs';
import { ExperimentDialog } from './ExperimentDialog';
import { ExperimentResultsTable } from './ExperimentResultsTable';
import { ExperimentStatusBadge, ExperimentTransitions } from './ExperimentTransitions';
import { loadExperiments } from './ExperimentsPage';

/** One experiment: definition, lifecycle actions and significance results. The API has no single-experiment GET, so the list is filtered. */
export function ExperimentDetailPage({ experimentKey }: { experimentKey: string }) {
  const api = useAdminApi();
  const { can } = useSession();
  const canManage = can('experiments.manage');
  const canSegments = can('flags.manage');
  const data = useResource(() => loadExperiments(api, canManage && canSegments), [api, canManage, canSegments]);
  const results = useResource(() => api.analytics.experimentResults(experimentKey), [api, experimentKey]);
  const [editing, setEditing] = useState(false);
  const reloadAll = () => { data.reload(); results.reload(); };

  const exp = data.status === 'success' ? data.data.experiments.find((e) => e.key === experimentKey) : undefined;
  const segmentKey = exp?.segment_id ? (data.status === 'success' ? data.data.segments?.find((s) => s.id === exp.segment_id)?.key : undefined) ?? exp.segment_id : null;

  return (
    <>
      <PageHeader
        title={experimentKey}
        intro={exp?.hypothesis ?? undefined}
        actions={exp ? (
          <>
            {canManage && exp.status === 'draft' ? <Button variant="secondary" onClick={() => setEditing(true)} aria-label={`${t('common.edit')} ${exp.key}`}>{t('common.edit')}</Button> : null}
            <ExperimentTransitions experimentKey={exp.key} status={exp.status} onDone={reloadAll} />
          </>
        ) : undefined}
      />
      <AnalyticsTabs />
      <p><Link href="/experiments">{t('analytics.experiments.back')}</Link></p>
      {data.status === 'loading' ? <LoadingState /> : null}
      {data.status === 'error' ? <ErrorState error={data.error} onRetry={data.reload} /> : null}
      {data.status === 'success' && !exp ? <EmptyState message={t('analytics.experiments.notFound', { key: experimentKey })} /> : null}
      {exp ? (
        <section className="card" aria-labelledby="exp-def">
          <h2 id="exp-def" className="card__title">{t('analytics.experiments.definition')}</h2>
          <DefinitionList items={[
            { label: t('analytics.experiments.status'), value: <ExperimentStatusBadge status={exp.status} /> },
            { label: t('analytics.experiments.surface'), value: t(`analytics.experiments.surfaces.${exp.surface}`) },
            { label: t('analytics.experiments.trafficPct'), value: formatPercent(exp.traffic_pct / 100, 0) },
            { label: t('analytics.experiments.primaryMetric'), value: <code>{exp.primary_metric}</code> },
            { label: t('analytics.experiments.segment'), value: segmentKey ? <code>{segmentKey}</code> : t('analytics.experiments.noSegment') },
            { label: t('analytics.experiments.created'), value: formatDateTime(exp.created_at) },
            { label: t('analytics.experiments.started'), value: formatDateTime(exp.started_at) },
            { label: t('analytics.experiments.ended'), value: formatDateTime(exp.ended_at) },
          ]} />
          <div className="table-wrap">
            <table className="table table--compact">
              <caption className="visually-hidden">{t('analytics.experiments.variants')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('analytics.experiments.variantKey')}</th>
                  <th scope="col" className="num">{t('analytics.experiments.allocation')}</th>
                  <th scope="col">{t('analytics.experiments.control')}</th>
                  <th scope="col">{t('analytics.experiments.config')}</th>
                </tr>
              </thead>
              <tbody>
                {exp.variants.map((v) => (
                  <tr key={v.id}>
                    <th scope="row"><code>{v.key}</code></th>
                    <td className="num">{formatPercent(v.allocation / 100, 0)}</td>
                    <td>{v.is_control ? t('common.yes') : t('common.no')}</td>
                    <td><pre className="pre-wrap" style={{ margin: 0 }}>{JSON.stringify(v.config ?? {}, null, 2)}</pre></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
      {data.status === 'success' && !exp ? null : (
        <section className="card" aria-labelledby="exp-results">
          <h2 id="exp-results" className="card__title">{t('analytics.experiments.results.title')}</h2>
          {results.status === 'loading' ? <LoadingState /> : null}
          {results.status === 'error' ? <ErrorState error={results.error} onRetry={results.reload} /> : null}
          {results.status === 'success' ? <ExperimentResultsTable results={results.data} /> : null}
        </section>
      )}
      {editing && exp && data.status === 'success' ? (
        <ExperimentDialog experiment={exp} segments={data.data.segments} onClose={() => setEditing(false)} onSaved={reloadAll} />
      ) : null}
    </>
  );
}
