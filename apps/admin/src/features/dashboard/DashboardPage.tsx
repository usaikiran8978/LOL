'use client';

import { useState } from 'react';
import { useNotify } from '@/components/shell/notice';
import { Button } from '@/components/ui/Button';
import { SelectField } from '@/components/ui/fields';
import { EmptyState, ErrorState, FormError, LoadingState, PageHeader } from '@/components/ui/states';
import { AnalyticsTabs } from '@/features/analytics/AnalyticsTabs';
import { ChartFigure } from '@/features/analytics/ChartFigure';
import type { ChartSeries } from '@/features/analytics/LineChart';
import { addDays, dimensionLabel, formatAxisValue, formatMetricValue, metricLabel, todayUtc } from '@/features/analytics/metrics';
import { t } from '@/i18n';
import { errorMessage, requestIdOf } from '@/lib/api/errors';
import type { DashboardLive, DashboardPoint, DashboardResponse, KpiUnit } from '@/lib/api/modules/dashboard';
import { useAdminApi, useSession } from '@/lib/auth/session';
import { downloadText } from '@/lib/download';
import { formatDate, formatNumber } from '@/lib/format';
import { useResource } from '@/lib/hooks/useResource';

const RANGES = [7, 30, 90, 365] as const;
const LIVE_KEYS: Array<keyof DashboardLive> = ['total_users', 'active_users', 'premium', 'open_cases', 'breached'];

function byDimension(points: DashboardPoint[]): Map<string, DashboardPoint[]> {
  const out = new Map<string, DashboardPoint[]>();
  for (const p of points) {
    const list = out.get(p.dimension) ?? [];
    list.push(p);
    out.set(p.dimension, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

export function DashboardPage() {
  const api = useAdminApi();
  const [days, setDays] = useState<number>(30);
  const data = useResource(() => api.dashboard.get(days), [api, days]);

  return (
    <>
      <PageHeader title={t('dashboard.title')} intro={t('dashboard.intro')} actions={<ExportButton days={days} />} />
      <AnalyticsTabs />
      <div className="segmented" role="group" aria-label={t('dashboard.range')}>
        {RANGES.map((d) => (
          <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)}>{t('dashboard.rangeDays', { days: d })}</button>
        ))}
      </div>
      {data.status === 'loading' ? <LoadingState /> : null}
      {data.status === 'error' ? <ErrorState error={data.error} onRetry={data.reload} /> : null}
      {data.status === 'success' ? <DashboardBody data={data.data} /> : null}
    </>
  );
}

function ExportButton({ days }: { days: number }) {
  const api = useAdminApi();
  const { can } = useSession();
  const notify = useNotify();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  if (!can('analytics.export')) return null;

  async function run() {
    // Same window as the dashboard query (server: today minus `days`, UTC); the server export is audited.
    const to = todayUtc();
    const from = addDays(to, -days);
    setBusy(true);
    setError(null);
    try {
      const csv = await api.analytics.exportCsv({ from, to });
      downloadText(csv, `metrics_${from}_${to}.csv`);
      notify(t('dashboard.exported'));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <Button variant="secondary" onClick={() => void run()} disabled={busy} aria-label={t('dashboard.exportLabel', { days })}>
        {busy ? t('analytics.exporting') : t('dashboard.exportCsv')}
      </Button>
      {error ? <FormError message={`${t('analytics.exportFailed')} ${errorMessage(error)}`} requestId={requestIdOf(error)} /> : null}
    </div>
  );
}

function DashboardBody({ data }: { data: DashboardResponse }) {
  const metrics = Object.keys(data.definitions).filter((k) => (data.series[k]?.length ?? 0) > 0);
  const [selected, setSelected] = useState<string>('');
  const current = metrics.includes(selected) ? selected : (metrics.includes('registrations') ? 'registrations' : (metrics[0] ?? ''));
  const unitOf = (k: string): KpiUnit => data.definitions[k]?.unit ?? 'score';
  const label = (k: string) => metricLabel(k, data.definitions[k]?.label);

  const trend: ChartSeries[] = current
    ? Array.from(byDimension(data.series[current] ?? []).entries()).map(([dim, pts]) => ({ id: dim, label: dimensionLabel(dim), points: pts }))
    : [];

  return (
    <>
      <section aria-labelledby="dash-live" className="stack" style={{ marginBottom: '1rem' }}>
        <h2 id="dash-live">{t('dashboard.live.title')}</h2>
        {data.live ? (
          <dl className="kpis">
            {LIVE_KEYS.map((k) => (
              <div key={k} className="kpi">
                <dt className="kpi__label">{t(`dashboard.live.${k}`)}</dt>
                <dd className="kpi__value" style={{ marginInlineStart: 0 }}>{formatNumber(data.live?.[k], 0)}</dd>
              </div>
            ))}
          </dl>
        ) : <p className="muted">{t('dashboard.noLive')}</p>}
      </section>

      {metrics.length === 0 ? <EmptyState message={t('dashboard.empty')} /> : (
        <>
          <section aria-labelledby="dash-trend" className="stack" style={{ marginBottom: '1rem' }}>
            <h2 id="dash-trend">{t('dashboard.trend.title')}</h2>
            <div className="filters">
              <SelectField label={t('dashboard.trend.metric')} value={current} onChange={setSelected} options={metrics.map((k) => ({ value: k, label: label(k) }))} />
            </div>
            <ChartFigure
              key={current}
              title={label(current)}
              series={trend}
              formatValue={(v, dim) => formatMetricValue(v, unitOf(current), dim)}
              formatAxis={(v) => formatAxisValue(v, unitOf(current), trend.length === 1 ? trend[0]!.id : 'all')}
            />
          </section>

          <section aria-labelledby="dash-latest">
            <h2 id="dash-latest">{t('dashboard.latest.title')}</h2>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">{t('dashboard.latest.metric')}</th>
                    <th scope="col">{t('dashboard.latest.dimension')}</th>
                    <th scope="col">{t('dashboard.latest.date')}</th>
                    <th scope="col" className="num">{t('dashboard.latest.value')}</th>
                    <th scope="col"><span className="visually-hidden">{t('common.actions')}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.flatMap((k) =>
                    Array.from(byDimension(data.series[k] ?? []).entries()).map(([dim, pts], i) => {
                      const last = pts[pts.length - 1]!;
                      return (
                        <tr key={`${k}:${dim}`} className={k === current ? 'is-selected' : undefined}>
                          <td>{i === 0 ? label(k) : <span className="visually-hidden">{label(k)}</span>}</td>
                          <td>{dimensionLabel(dim)}</td>
                          <td>{formatDate(last.date)}</td>
                          <td className="num">{formatMetricValue(last.value, unitOf(k), dim)}</td>
                          <td className="table__actions">
                            {i === 0 ? (
                              <Button variant="ghost" size="sm" onClick={() => setSelected(k)} aria-label={t('dashboard.latest.showFor', { metric: label(k) })}>
                                {t('dashboard.latest.show')}
                              </Button>
                            ) : null}
                          </td>
                        </tr>
                      );
                    }),
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  );
}
