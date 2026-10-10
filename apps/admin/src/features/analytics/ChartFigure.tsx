'use client';

import { useId, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { t } from '@/i18n';
import { formatDate } from '@/lib/format';
import { LineChart, seriesStyle, type ChartSeries } from './LineChart';

interface Props {
  title: string;
  series: ChartSeries[];
  formatValue: (value: number, seriesId: string) => string;
  formatAxis: (value: number) => string;
  /** Column header for the date column of the data table. */
  dateLabel?: string;
  /** Show the data table initially (e.g. the explorer, where the table is a primary view). */
  tableOpen?: boolean;
}

/** Chart + legend (≥2 series) + toggleable data table: the table is the chart's complete text alternative. */
export function ChartFigure({ title, series, formatValue, formatAxis, dateLabel, tableOpen = false }: Props) {
  const tableId = useId();
  const [open, setOpen] = useState(tableOpen);
  const dates = Array.from(new Set(series.flatMap((s) => s.points.map((p) => p.date)))).sort();
  const lookup = series.map((s) => new Map(s.points.map((p) => [p.date, p.value])));

  return (
    <figure className="card" style={{ margin: 0 }}>
      <figcaption className="card__title">{title}</figcaption>
      <LineChart title={title} series={series} formatValue={formatValue} formatAxis={formatAxis} />
      {series.length > 1 ? (
        <ul aria-label={t('analytics.chart.legend')} className="row" style={{ listStyle: 'none', padding: 0, margin: '0.5rem 0 0' }}>
          {series.map((s, i) => {
            const st = seriesStyle(i);
            return (
              <li key={s.id} className="row" style={{ gap: '0.35rem' }}>
                <svg width="24" height="10" aria-hidden="true"><line x1="0" x2="24" y1="5" y2="5" stroke={st.color} strokeWidth={2} strokeDasharray={st.dash} /></svg>
                <span>{s.label}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
      <div className="toolbar" style={{ marginTop: '0.5rem' }}>
        <Button variant="ghost" size="sm" aria-expanded={open} aria-controls={tableId} onClick={() => setOpen((o) => !o)}>
          {open ? t('analytics.chart.hideTable') : t('analytics.chart.showTable')}
        </Button>
      </div>
      <div id={tableId} className="table-wrap" hidden={!open}>
        {open ? (
          <table className="table table--compact">
            <caption className="visually-hidden">{title}</caption>
            <thead>
              <tr>
                <th scope="col">{dateLabel ?? t('analytics.date')}</th>
                {series.map((s) => <th key={s.id} scope="col" className="num">{s.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {dates.map((d) => (
                <tr key={d}>
                  <th scope="row" style={{ fontWeight: 'normal' }}>{formatDate(d)}</th>
                  {series.map((s, i) => {
                    const v = lookup[i]!.get(d);
                    return <td key={s.id} className="num">{v === undefined ? '—' : formatValue(v, s.id)}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </figure>
  );
}
