'use client';

import { useState } from 'react';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui/states';
import { t } from '@/i18n';
import type { AiUsageRow } from '@/lib/api/modules/ai';
import { useAdminApi } from '@/lib/auth/session';
import { formatDate, formatNumber, formatPercent } from '@/lib/format';
import { useResource } from '@/lib/hooks/useResource';
import { AiTabs, featureName, formatInt, formatUsd, toNumber } from './shared';
import { groupBy, totals, type UsageTotals } from './usageStats';

/** Periods accepted by GET admin/ai/usage (`days` 1–90, default 14). */
const PERIODS = [7, 14, 30, 90] as const;

export function UsagePage() {
  const api = useAdminApi();
  const [days, setDays] = useState<number>(14);
  const data = useResource(() => api.ai.usage(days), [api, days]);

  return (
    <>
      <PageHeader title={t('ai.usage.title')} intro={t('ai.usage.intro')} />
      <AiTabs />
      <div className="segmented" role="group" aria-label={t('ai.usage.range')}>
        {PERIODS.map((p) => (
          <button key={p} type="button" aria-pressed={days === p} onClick={() => setDays(p)}>{t('ai.usage.lastDays', { days: p })}</button>
        ))}
      </div>
      {data.status === 'loading' ? <LoadingState /> : null}
      {data.status === 'error' ? <ErrorState error={data.error} onRetry={data.reload} /> : null}
      {data.status === 'success' && data.data.length === 0 ? <EmptyState message={t('ai.usage.empty')} /> : null}
      {data.status === 'success' && data.data.length > 0 ? <UsageReport rows={data.data} /> : null}
    </>
  );
}

function UsageReport({ rows }: { rows: AiUsageRow[] }) {
  const all = totals(rows);
  const byFeature = groupBy(rows, (r) => r.feature_key).sort((a, b) => b.totals.cost - a.totals.cost || b.totals.requests - a.totals.requests);
  const byDay = groupBy(rows, (r) => r.day).sort((a, b) => (a.key < b.key ? 1 : -1));
  const kpis: Array<[string, string]> = [
    [t('ai.usage.requests'), formatInt(all.requests)],
    [t('ai.usage.successRate'), all.requests ? formatPercent(all.succeeded / all.requests) : '—'],
    [t('ai.usage.fallbacks'), formatInt(all.fallbacks)],
    [t('ai.usage.blocked'), formatInt(all.blocked)],
    [t('ai.usage.inputTokens'), formatInt(all.inputTokens)],
    [t('ai.usage.outputTokens'), formatInt(all.outputTokens)],
    [t('ai.usage.cost'), formatUsd(all.cost)],
  ];

  return (
    <>
      <div className="kpis">
        {kpis.map(([label, value]) => (
          <div key={label} className="kpi">
            <p className="kpi__label">{label}</p>
            <p className="kpi__value">{value}</p>
          </div>
        ))}
      </div>
      <p className="muted">{t('ai.usage.noModelBreakdown')}</p>
      <TotalsTable
        title={t('ai.usage.byFeature')}
        keyHeader={t('ai.usage.feature')}
        groups={byFeature}
        renderKey={(k) => featureName(k)}
        maxCost={Math.max(0, ...byFeature.map((g) => g.totals.cost))}
      />
      <TotalsTable
        title={t('ai.usage.byDay')}
        keyHeader={t('ai.usage.day')}
        groups={byDay}
        renderKey={(k) => formatDate(k)}
        maxCost={Math.max(0, ...byDay.map((g) => g.totals.cost))}
      />
      <DetailTable rows={rows} />
    </>
  );
}

/** Proportional bar; decorative only (the exact value is in the adjacent cell), RTL-safe via logical sizing. */
function Bar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div aria-hidden="true" style={{ inlineSize: '100%', minInlineSize: '4rem', blockSize: '0.6rem', background: 'var(--bg)', borderRadius: 'var(--radius)' }}>
      <div style={{ inlineSize: `${pct}%`, blockSize: '100%', background: 'var(--primary)', borderRadius: 'var(--radius)' }} />
    </div>
  );
}

function TotalsTable({ title, keyHeader, groups, renderKey, maxCost }: {
  title: string; keyHeader: string; groups: Array<{ key: string; totals: UsageTotals }>; renderKey: (k: string) => string; maxCost: number;
}) {
  return (
    <section className="section">
      <div className="table-wrap">
        <table className="table">
          <caption className="table__caption">{title}</caption>
          <thead>
            <tr>
              <th scope="col">{keyHeader}</th>
              <th scope="col" className="num">{t('ai.usage.requests')}</th>
              <th scope="col" className="num">{t('ai.usage.succeeded')}</th>
              <th scope="col" className="num">{t('ai.usage.fallbacks')}</th>
              <th scope="col" className="num">{t('ai.usage.blocked')}</th>
              <th scope="col" className="num">{t('ai.usage.inputTokens')}</th>
              <th scope="col" className="num">{t('ai.usage.outputTokens')}</th>
              <th scope="col" className="num">{t('ai.usage.cost')}</th>
              <th scope="col">{t('ai.usage.share')}</th>
            </tr>
          </thead>
          <tbody>
            {groups.map(({ key, totals: g }) => (
              <tr key={key}>
                <th scope="row">{renderKey(key)}</th>
                <td className="num">{formatInt(g.requests)}</td>
                <td className="num">{formatInt(g.succeeded)}</td>
                <td className="num">{formatInt(g.fallbacks)}</td>
                <td className="num">{formatInt(g.blocked)}</td>
                <td className="num">{formatInt(g.inputTokens)}</td>
                <td className="num">{formatInt(g.outputTokens)}</td>
                <td className="num">{formatUsd(g.cost)}</td>
                <td><Bar value={g.cost} max={maxCost} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DetailTable({ rows }: { rows: AiUsageRow[] }) {
  return (
    <section className="section">
      <div className="table-wrap">
        <table className="table table--compact">
          <caption className="table__caption">{t('ai.usage.detail')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('ai.usage.day')}</th>
              <th scope="col">{t('ai.usage.feature')}</th>
              <th scope="col" className="num">{t('ai.usage.requests')}</th>
              <th scope="col" className="num">{t('ai.usage.succeeded')}</th>
              <th scope="col" className="num">{t('ai.usage.fallbacks')}</th>
              <th scope="col" className="num">{t('ai.usage.blocked')}</th>
              <th scope="col" className="num">{t('ai.usage.inputTokens')}</th>
              <th scope="col" className="num">{t('ai.usage.outputTokens')}</th>
              <th scope="col" className="num">{t('ai.usage.cost')}</th>
              <th scope="col" className="num">{t('ai.usage.p95')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.day}-${r.feature_key}`} className={r.requests > 0 && r.succeeded < r.requests / 2 ? 'is-warning' : undefined}>
                <td>{formatDate(r.day)}</td>
                <td>{featureName(r.feature_key)}</td>
                <td className="num">{formatInt(r.requests)}</td>
                <td className="num">{formatInt(r.succeeded)}</td>
                <td className="num">{formatInt(r.fallbacks)}</td>
                <td className="num">{formatInt(r.blocked)}</td>
                <td className="num">{formatInt(r.input_tokens)}</td>
                <td className="num">{formatInt(r.output_tokens)}</td>
                <td className="num">{formatUsd(r.cost_usd)}</td>
                <td className="num">{formatNumber(toNumber(r.p95_latency_ms), 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
