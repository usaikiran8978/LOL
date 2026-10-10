'use client';

import { useState } from 'react';
import { z } from 'zod';
import { useNotify } from '@/components/shell/notice';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { SelectField, TextField } from '@/components/ui/fields';
import { EmptyState, ErrorState, FormError, LoadingState, PageHeader } from '@/components/ui/states';
import { t } from '@/i18n';
import { errorMessage, requestIdOf } from '@/lib/api/errors';
import type { SeriesQuery } from '@/lib/api/modules/analytics';
import { useAdminApi, useSession } from '@/lib/auth/session';
import { downloadText } from '@/lib/download';
import { validate, type FieldErrors } from '@/lib/forms/validate';
import { useResource } from '@/lib/hooks/useResource';
import { AnalyticsTabs } from './AnalyticsTabs';
import { ChartFigure } from './ChartFigure';
import { DateField } from './DateField';
import { addDays, daysBetween, dimensionLabel, formatAxisValue, formatMetricValue, isDay, KPI_CATALOG, metricLabel, todayUtc } from './metrics';

// Mirrors `seriesQuery` in apps/api/src/modules/analytics/analytics.controller.ts (not exported from @amora/shared).
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const seriesQuerySchema = z.object({ from: day, to: day, dimension: z.string().regex(/^[a-z]+(:[A-Za-z0-9_]+)?$/) });

/** The API has no range cap; this keeps the chart and table readable. */
const MAX_DAYS = 366;

type DimKind = 'all' | 'country' | 'currency';
interface Draft { metric: string; from: string; to: string; dimKind: DimKind; code: string }
interface Applied extends SeriesQuery { metric: string }

const catalogEntry = (metric: string) => KPI_CATALOG.find((m) => m.key === metric) ?? KPI_CATALOG[0]!;

function dimKinds(metric: string): DimKind[] {
  const d = catalogEntry(metric).dimension;
  if (d === 'currency') return ['currency']; // money is stored per currency only
  return d === 'country' ? ['all', 'country'] : ['all'];
}

function toQuery(d: Draft): { ok: true; value: Applied } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  if (!isDay(d.from)) errors.from = t('analytics.invalidDay');
  if (!isDay(d.to)) errors.to = t('analytics.invalidDay');
  if (!errors.from && !errors.to) {
    if (d.to < d.from) errors.to = t('analytics.rangeOrder');
    else if (daysBetween(d.from, d.to) > MAX_DAYS) errors.from = t('analytics.rangeTooLong', { max: MAX_DAYS });
  }
  const code = d.code.trim().toUpperCase();
  if (d.dimKind === 'country' && !/^[A-Z]{2}$/.test(code)) errors.code = t('analytics.invalidCountry');
  if (d.dimKind === 'currency' && !/^[A-Z]{3}$/.test(code)) errors.code = t('analytics.invalidCurrency');
  const dimension = d.dimKind === 'all' ? 'all' : `${d.dimKind}:${code}`;
  const v = validate(seriesQuerySchema, { from: d.from, to: d.to, dimension });
  if (!v.ok) for (const [k, msg] of Object.entries(v.errors)) errors[k === 'dimension' ? 'code' : k] ??= msg;
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { metric: d.metric, from: d.from, to: d.to, dimension } };
}

export function MetricsExplorerPage() {
  const api = useAdminApi();
  const { can } = useSession();
  const today = todayUtc();
  const initial: Draft = { metric: 'registrations', from: addDays(today, -29), to: today, dimKind: 'all', code: '' };
  const [draft, setDraft] = useState<Draft>(initial);
  const [applied, setApplied] = useState<Applied>({ metric: initial.metric, from: initial.from, to: initial.to, dimension: 'all' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [recomputing, setRecomputing] = useState(false);
  const data = useResource(
    () => api.analytics.series(applied.metric, { from: applied.from, to: applied.to, dimension: applied.dimension }),
    [api, applied.metric, applied.from, applied.to, applied.dimension],
  );

  const kinds = dimKinds(draft.metric);
  const set = <K extends keyof Draft>(k: K) => (v: Draft[K]) => setDraft((s) => ({ ...s, [k]: v }));

  function changeMetric(metric: string) {
    const allowed = dimKinds(metric);
    setDraft((s) => ({ ...s, metric, dimKind: allowed.includes(s.dimKind) ? s.dimKind : allowed[0]!, code: allowed.includes(s.dimKind) ? s.code : '' }));
  }

  function apply() {
    const r = toQuery(draft);
    if (!r.ok) return setErrors(r.errors);
    setErrors({});
    setApplied(r.value);
  }

  const unit = catalogEntry(applied.metric).unit;
  const label = metricLabel(applied.metric);
  const canExport = can('analytics.export');

  return (
    <>
      <PageHeader
        title={t('analytics.title')}
        intro={t('analytics.intro')}
        actions={canExport ? (
          <>
            <ExportButton from={applied.from} to={applied.to} />
            <Button variant="secondary" onClick={() => setRecomputing(true)}>{t('analytics.recompute')}</Button>
          </>
        ) : undefined}
      />
      <AnalyticsTabs />
      <form className="filters" noValidate onSubmit={(e) => { e.preventDefault(); apply(); }}>
        <SelectField label={t('analytics.metric')} value={draft.metric} onChange={changeMetric} options={KPI_CATALOG.map((m) => ({ value: m.key, label: metricLabel(m.key) }))} />
        <DateField label={t('analytics.from')} value={draft.from} onChange={set('from')} error={errors.from} max={draft.to || undefined} required />
        <DateField label={t('analytics.to')} value={draft.to} onChange={set('to')} error={errors.to} min={draft.from || undefined} required />
        <SelectField
          label={t('analytics.dimension')}
          value={draft.dimKind}
          onChange={(v) => setDraft((s) => ({ ...s, dimKind: v as DimKind }))}
          options={kinds.map((k) => ({ value: k, label: t(`analytics.dimensions.${k}`) }))}
        />
        {draft.dimKind !== 'all' ? (
          <TextField
            label={t('analytics.dimensionValue')}
            hint={draft.dimKind === 'country' ? t('analytics.countryHint') : t('analytics.currencyHint')}
            value={draft.code}
            onChange={set('code')}
            error={errors.code}
            maxLength={draft.dimKind === 'country' ? 2 : 3}
            autoComplete="off"
            spellCheck={false}
            required
          />
        ) : null}
        <Button type="submit">{t('analytics.show')}</Button>
      </form>
      <p className="muted">{t('analytics.granularityNote')}</p>

      {data.status === 'loading' ? <LoadingState /> : null}
      {data.status === 'error' ? <ErrorState error={data.error} onRetry={data.reload} /> : null}
      {data.status === 'success' && data.data.length === 0 ? <EmptyState message={t('analytics.empty')} /> : null}
      {data.status === 'success' && data.data.length > 0 ? (
        <ChartFigure
          key={`${applied.metric}|${applied.dimension}`}
          title={t('analytics.seriesTitle', { metric: label, dimension: dimensionLabel(applied.dimension) })}
          series={[{ id: applied.dimension, label, points: data.data.map((p) => ({ date: String(p.metric_date).slice(0, 10), value: Number(p.value) })) }]}
          formatValue={(v) => formatMetricValue(v, unit, applied.dimension)}
          formatAxis={(v) => formatAxisValue(v, unit, applied.dimension)}
          tableOpen
        />
      ) : null}

      {recomputing ? <RecomputeDialog initialDay={applied.to} onClose={() => setRecomputing(false)} onDone={data.reload} /> : null}
    </>
  );
}

function ExportButton({ from, to }: { from: string; to: string }) {
  const api = useAdminApi();
  const notify = useNotify();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const csv = await api.analytics.exportCsv({ from, to });
      downloadText(csv, `metrics_${from}_${to}.csv`);
      notify(t('analytics.exported'));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="secondary" onClick={() => void run()} disabled={busy} title={t('analytics.exportHint')}>
        {busy ? t('analytics.exporting') : t('analytics.exportCsv')}
      </Button>
      {error ? <FormError message={`${t('analytics.exportFailed')} ${errorMessage(error)}`} requestId={requestIdOf(error)} /> : null}
    </>
  );
}

function RecomputeDialog({ initialDay, onClose, onDone }: { initialDay: string; onClose: () => void; onDone: () => void }) {
  const api = useAdminApi();
  const notify = useNotify();
  const [value, setValue] = useState(initialDay);
  const [error, setError] = useState<string | undefined>();

  async function confirm(): Promise<boolean> {
    if (!isDay(value)) {
      setError(t('analytics.invalidDay'));
      return false;
    }
    setError(undefined);
    await api.analytics.recompute(value);
    notify(t('analytics.recomputed', { day: value }));
    onDone();
    return true;
  }

  return (
    <ConfirmDialog title={t('analytics.recomputeTitle')} body={t('analytics.recomputeBody')} confirmLabel={t('analytics.recomputeConfirm')} onConfirm={confirm} onClose={onClose}>
      <DateField label={t('analytics.recomputeDay')} value={value} onChange={setValue} error={error} max={todayUtc()} required />
    </ConfirmDialog>
  );
}
