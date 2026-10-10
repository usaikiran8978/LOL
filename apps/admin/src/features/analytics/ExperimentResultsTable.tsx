'use client';

import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/states';
import { locale, t } from '@/i18n';
import type { ExperimentResults, VariantResult } from '@/lib/api/modules/analytics';
import { formatNumber, formatPercent } from '@/lib/format';

const ALPHA = 0.05;

function signedPercent(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1, signDisplay: 'exceptZero' }).format(v);
}

function pValue(p: number | null | undefined): string {
  if (p === null || p === undefined || Number.isNaN(p)) return '—';
  return p < 0.001 ? t('analytics.experiments.results.pBelow') : formatNumber(p, 3);
}

function Significance({ v }: { v: VariantResult }) {
  if (v.isControl) return <Badge tone="neutral">{t('analytics.experiments.results.baseline')}</Badge>;
  const test = v.vsControl;
  if (!test || test.pValue === null || test.z === null) return <Badge tone="neutral">{t('analytics.experiments.results.insufficient')}</Badge>;
  if (test.pValue >= ALPHA) return <Badge tone="neutral">{t('analytics.experiments.results.notSignificant')}</Badge>;
  const better = test.z > 0;
  return (
    <span className="stack">
      <Badge tone={better ? 'success' : 'danger'}>{t('analytics.experiments.results.significant')}</Badge>
      <span>{better ? t('analytics.experiments.results.better') : t('analytics.experiments.results.worse')}</span>
    </span>
  );
}

/** Per-variant conversion with lift, 95% CI of the difference, p-value and a significance verdict vs control. */
export function ExperimentResultsTable({ results }: { results: ExperimentResults }) {
  if (results.variants.length === 0) return <EmptyState message={t('analytics.experiments.results.empty')} />;
  const hasControl = results.variants.some((v) => v.isControl);
  return (
    <>
      <p className="muted">{t('analytics.experiments.results.intro', { metric: results.primaryMetric })}</p>
      {!hasControl ? <p role="note">{t('analytics.experiments.results.noControl')}</p> : null}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">{t('analytics.experiments.variantKey')}</th>
              <th scope="col" className="num">{t('analytics.experiments.allocation')}</th>
              <th scope="col" className="num">{t('analytics.experiments.results.assigned')}</th>
              <th scope="col" className="num">{t('analytics.experiments.results.converted')}</th>
              <th scope="col" className="num">{t('analytics.experiments.results.rate')}</th>
              <th scope="col" className="num">{t('analytics.experiments.results.lift')}</th>
              <th scope="col">{t('analytics.experiments.results.ci95')}</th>
              <th scope="col" className="num">{t('analytics.experiments.results.pValue')}</th>
              <th scope="col" className="num">{t('analytics.experiments.results.z')}</th>
              <th scope="col">{t('analytics.experiments.results.significance')}</th>
            </tr>
          </thead>
          <tbody>
            {results.variants.map((v) => (
              <tr key={v.key}>
                <th scope="row">
                  <code>{v.key}</code>
                  {v.isControl ? <> <Badge tone="info">{t('analytics.experiments.control')}</Badge></> : null}
                </th>
                <td className="num">{formatPercent(v.allocation / 100, 0)}</td>
                <td className="num">{formatNumber(v.assigned, 0)}</td>
                <td className="num">{formatNumber(v.converted, 0)}</td>
                <td className="num">{formatPercent(v.rate, 2)}</td>
                <td className="num">{v.isControl ? '—' : signedPercent(v.vsControl?.lift)}</td>
                <td>
                  {v.vsControl?.ci95
                    ? t('analytics.experiments.results.ciRange', { low: signedPercent(v.vsControl.ci95[0]), high: signedPercent(v.vsControl.ci95[1]) })
                    : '—'}
                </td>
                <td className="num">{v.isControl ? '—' : pValue(v.vsControl?.pValue)}</td>
                <td className="num">{v.isControl || v.vsControl?.z === null || v.vsControl?.z === undefined ? '—' : formatNumber(v.vsControl.z, 2)}</td>
                <td><Significance v={v} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted">{t('analytics.experiments.results.ciNote')}</p>
    </>
  );
}
