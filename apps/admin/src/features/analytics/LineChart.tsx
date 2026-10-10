'use client';

import { useId, useMemo, useRef, useState, type MouseEvent } from 'react';
import { dir, t } from '@/i18n';
import { formatDate } from '@/lib/format';

export interface ChartSeries {
  id: string;
  label: string;
  points: ReadonlyArray<{ date: string; value: number }>;
}

/** Categorical slots in fixed order (validated reference palette); dash patterns add a non-colour cue. */
const COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300'];
const DASHES = [undefined, '6 4', '2 3', '8 3 2 3', '1 3', '10 4'];
export const seriesStyle = (i: number) => ({ color: COLORS[i % COLORS.length]!, dash: DASHES[i % DASHES.length] });

const W = 720;
const H = 240;
const PAD = { top: 12, bottom: 28, axis: 72, end: 16 };

function niceTicks(min: number, max: number, count = 4): number[] {
  const span = max - min || Math.abs(max) || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 0.5 && ticks.length < 12; v += step) ticks.push(Number(v.toPrecision(12)));
  return ticks;
}

interface Props {
  /** Accessible name of the chart (the visible caption usually repeats it). */
  title: string;
  series: ChartSeries[];
  formatValue: (value: number, seriesId: string) => string;
  formatAxis: (value: number) => string;
}

/**
 * Dependency-free inline SVG line chart for daily series. The time axis runs in the reading direction: in RTL
 * locales the earliest day is on the right and the value axis on the right edge. The SVG carries a text summary
 * (`<desc>`); callers pair it with a data table (see ChartFigure) as the full text alternative.
 */
export function LineChart({ title, series, formatValue, formatAxis }: Props) {
  const titleId = useId();
  const descId = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const rtl = dir === 'rtl';

  const model = useMemo(() => {
    const dates = Array.from(new Set(series.flatMap((s) => s.points.map((p) => p.date)))).sort();
    const values = series.flatMap((s) => s.points.map((p) => p.value));
    const lo = Math.min(0, ...values);
    const hiRaw = Math.max(...values, lo);
    const ticks = niceTicks(lo, hiRaw === lo ? lo + 1 : hiRaw);
    const yMin = Math.min(lo, ticks[0] ?? lo);
    const yMax = Math.max(hiRaw, ticks[ticks.length - 1] ?? hiRaw, yMin + 1e-9);
    const left = rtl ? PAD.end : PAD.axis;
    const right = rtl ? W - PAD.axis : W - PAD.end;
    const index = new Map(dates.map((d, i) => [d, i]));
    const x = (i: number) => {
      const f = dates.length <= 1 ? 0.5 : i / (dates.length - 1);
      return rtl ? right - f * (right - left) : left + f * (right - left);
    };
    const y = (v: number) => PAD.top + (1 - (v - yMin) / (yMax - yMin)) * (H - PAD.top - PAD.bottom);
    return { dates, ticks, left, right, index, x, y };
  }, [series, rtl]);

  const { dates, ticks, left, right, index, x, y } = model;
  if (dates.length === 0) return <p className="muted">{t('analytics.chart.noData')}</p>;

  const summary = series.map((s) => {
    const vals = s.points.map((p) => p.value);
    const last = s.points[s.points.length - 1];
    if (!last) return '';
    return t('analytics.chart.summary', {
      series: s.label,
      count: s.points.length,
      from: formatDate(s.points[0]!.date),
      to: formatDate(last.date),
      min: formatValue(Math.min(...vals), s.id),
      max: formatValue(Math.max(...vals), s.id),
      latest: formatValue(last.value, s.id),
    });
  }).filter(Boolean).join(' ');

  const xLabels = Array.from(new Set([0, Math.floor((dates.length - 1) / 2), dates.length - 1]));
  const axisX = rtl ? right + 8 : left - 8;

  function onMove(e: MouseEvent<SVGRectElement>) {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    const px = ((e.clientX - box.left) / box.width) * W;
    const f = (px - left) / (right - left || 1);
    const i = Math.round((rtl ? 1 - f : f) * (dates.length - 1));
    setHover(Math.max(0, Math.min(dates.length - 1, i)));
  }

  const hoverDate = hover === null ? undefined : dates[hover];
  const hoverX = hover === null ? 0 : x(hover);
  const readF = rtl ? (W - hoverX) / W : hoverX / W;

  return (
    <div style={{ position: 'relative' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-labelledby={`${titleId} ${descId}`}
        style={{ display: 'block', maxWidth: '100%', height: 'auto', direction: 'ltr', overflow: 'visible' }}
      >
        <title id={titleId}>{title}</title>
        <desc id={descId}>{summary}</desc>
        <g aria-hidden="true">
          {ticks.map((v) => (
            <g key={v}>
              <line x1={left} x2={right} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth={1} />
              <text x={axisX} y={y(v)} dy="0.32em" textAnchor={rtl ? 'start' : 'end'} fontSize={11} fill="var(--muted)">{formatAxis(v)}</text>
            </g>
          ))}
          {xLabels.map((i) => (
            <text key={i} x={x(i)} y={H - 8} fontSize={11} fill="var(--muted)" textAnchor={dates.length === 1 ? 'middle' : i === 0 ? (rtl ? 'end' : 'start') : i === dates.length - 1 ? (rtl ? 'start' : 'end') : 'middle'}>
              {formatDate(dates[i])}
            </text>
          ))}
          {series.map((s, si) => {
            const style = seriesStyle(si);
            const pts = s.points.map((p) => [x(index.get(p.date) ?? 0), y(p.value)] as const);
            const last = pts[pts.length - 1];
            return (
              <g key={s.id}>
                {pts.length > 1 ? (
                  <polyline points={pts.map(([a, b]) => `${a},${b}`).join(' ')} fill="none" stroke={style.color} strokeWidth={2} strokeDasharray={style.dash} strokeLinejoin="round" strokeLinecap="round" />
                ) : null}
                {last ? <circle cx={last[0]} cy={last[1]} r={4} fill={style.color} stroke="var(--surface)" strokeWidth={2} /> : null}
              </g>
            );
          })}
          {hoverDate ? (
            <g>
              <line x1={hoverX} x2={hoverX} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--muted)" strokeWidth={1} />
              {series.map((s, si) => {
                const p = s.points.find((q) => q.date === hoverDate);
                return p ? <circle key={s.id} cx={hoverX} cy={y(p.value)} r={4} fill={seriesStyle(si).color} stroke="var(--surface)" strokeWidth={2} /> : null;
              })}
            </g>
          ) : null}
          <rect x={Math.min(left, right)} y={PAD.top} width={Math.abs(right - left)} height={H - PAD.top - PAD.bottom} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
        </g>
      </svg>
      {hoverDate ? (
        <div
          aria-hidden="true"
          className="card"
          style={{
            position: 'absolute', top: 0, padding: '0.4rem 0.6rem', fontSize: '0.8rem', pointerEvents: 'none', whiteSpace: 'nowrap',
            // Position in the reading direction, on whichever side of the crosshair has more room.
            ...(readF < 0.5 ? { insetInlineStart: `${readF * 100 + 2}%` } : { insetInlineEnd: `${(1 - readF) * 100 + 2}%` }),
          }}
        >
          <strong>{formatDate(hoverDate)}</strong>
          {series.map((s) => {
            const p = s.points.find((q) => q.date === hoverDate);
            return <div key={s.id}>{series.length > 1 ? `${s.label}: ` : ''}{p ? formatValue(p.value, s.id) : '—'}</div>;
          })}
        </div>
      ) : null}
    </div>
  );
}
