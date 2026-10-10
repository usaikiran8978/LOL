import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '@/i18n';
import { downloadText } from '@/lib/download';
import { apiError, field, json, renderSignedIn, type RecordedCall } from '@/test/utils';
import { MetricsExplorerPage } from './MetricsExplorerPage';
import { addDays, formatMetricValue, isDay, todayUtc } from './metrics';

vi.mock('@/lib/download', () => ({ downloadText: vi.fn() }));
beforeEach(() => vi.mocked(downloadText).mockClear());

const points = [{ metric_date: '2026-10-06', value: '10' }, { metric_date: '2026-10-07', value: '12.0000' }];
const seriesCalls = (calls: RecordedCall[]) => calls.filter((c) => c.path.startsWith('/admin/analytics/metrics/'));

describe('metrics helpers', () => {
  it('formats by unit and handles calendar days', () => {
    expect(formatMetricValue(0.125, 'ratio')).toBe('12.5%');
    expect(formatMetricValue(1999, 'minor_currency', 'currency:USD')).toBe('$19.99');
    expect(formatMetricValue(3.25, 'hours')).toBe(t('analytics.units.hours', { value: '3.3' }));
    expect(isDay('2026-02-30')).toBe(false);
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('MetricsExplorerPage', () => {
  it('loads the default series and renders chart + table', async () => {
    const { calls } = await renderSignedIn(<MetricsExplorerPage />, { 'GET /admin/analytics/metrics/registrations': () => points });
    expect(await screen.findByRole('img', { name: /Registrations/ })).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByText('12')).toBeInTheDocument();
    const q = seriesCalls(calls)[0]!.query;
    expect(q.get('dimension')).toBe('all');
    expect(q.get('to')).toBe(todayUtc());
    expect(q.get('from')).toBe(addDays(todayUtc(), -29));
  });

  it('requires a currency for money metrics and queries the currency dimension', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<MetricsExplorerPage />, {
      'GET /admin/analytics/metrics/registrations': () => points,
      'GET /admin/analytics/metrics/revenue': () => [{ metric_date: '2026-10-07', value: '2500' }],
    });
    await screen.findByRole('table');
    await user.selectOptions(field(t('analytics.metric')), 'revenue');
    expect(field(t('analytics.dimension'))).toHaveValue('currency');
    await user.click(screen.getByRole('button', { name: t('analytics.show') }));
    expect(screen.getByText(t('analytics.invalidCurrency'))).toBeInTheDocument();
    expect(seriesCalls(calls)).toHaveLength(1);
    await user.type(field(t('analytics.dimensionValue')), 'usd');
    await user.click(screen.getByRole('button', { name: t('analytics.show') }));
    await waitFor(() => expect(seriesCalls(calls)).toHaveLength(2));
    expect(seriesCalls(calls)[1]!.query.get('dimension')).toBe('currency:USD');
    expect(await screen.findAllByText('$25.00')).not.toHaveLength(0);
  });

  it('validates the date range order', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<MetricsExplorerPage />, { 'GET /admin/analytics/metrics/registrations': () => points });
    await screen.findByRole('table');
    const from = field(t('analytics.from'));
    await user.clear(from);
    await user.type(from, addDays(todayUtc(), 5));
    await user.click(screen.getByRole('button', { name: t('analytics.show') }));
    expect(screen.getByText(t('analytics.rangeOrder'))).toBeInTheDocument();
    expect(seriesCalls(calls)).toHaveLength(1);
  });

  it('shows empty and error states with retry', async () => {
    const user = userEvent.setup();
    let mode: 'error' | 'empty' = 'error';
    await renderSignedIn(<MetricsExplorerPage />, { 'GET /admin/analytics/metrics/registrations': () => (mode === 'error' ? apiError(500, 'INTERNAL') : []) });
    expect(await screen.findByText(t('errors.INTERNAL'))).toBeInTheDocument();
    mode = 'empty';
    await user.click(screen.getByRole('button', { name: t('common.retry') }));
    expect(await screen.findByText(t('analytics.empty'))).toBeInTheDocument();
  });

  it('hides export and recompute without analytics.export', async () => {
    await renderSignedIn(<MetricsExplorerPage />, { 'GET /admin/analytics/metrics/registrations': () => points }, ['analytics.view']);
    await screen.findByRole('table');
    expect(screen.queryByRole('button', { name: t('analytics.exportCsv') })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('analytics.recompute') })).not.toBeInTheDocument();
  });

  it('exports the selected range as CSV', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<MetricsExplorerPage />, {
      'GET /admin/analytics/metrics/registrations': () => points,
      'GET /admin/analytics/export.csv': () => new Response('date,metric,dimension,value', { status: 200 }),
    });
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: t('analytics.exportCsv') }));
    await waitFor(() => expect(downloadText).toHaveBeenCalledWith('date,metric,dimension,value', `metrics_${addDays(todayUtc(), -29)}_${todayUtc()}.csv`));
    const q = calls.find((c) => c.path === '/admin/analytics/export.csv')!.query;
    expect(q.get('from')).toBe(addDays(todayUtc(), -29));
  });

  it('recomputes a day only after confirmation, then reloads the series', async () => {
    const user = userEvent.setup();
    const today = todayUtc();
    const { calls, mutations } = await renderSignedIn(<MetricsExplorerPage />, {
      'GET /admin/analytics/metrics/registrations': () => points,
      [`POST /admin/analytics/recompute/${today}`]: () => json(204),
    });
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: t('analytics.recompute') }));
    const d = screen.getByRole('dialog', { name: t('analytics.recomputeTitle') });
    expect(within(d).getByLabelText(t('analytics.recomputeDay'), { exact: false })).toHaveValue(today);
    const recomputes = () => mutations().filter((c) => c.path.startsWith('/admin/analytics/recompute/'));
    expect(recomputes()).toHaveLength(0);
    await user.click(within(d).getByRole('button', { name: t('analytics.recomputeConfirm') }));
    await waitFor(() => expect(recomputes()).toHaveLength(1));
    expect(recomputes()[0]!.path).toBe(`/admin/analytics/recompute/${today}`);
    expect(await screen.findByText(t('analytics.recomputed', { day: today }))).toBeInTheDocument();
    await waitFor(() => expect(seriesCalls(calls)).toHaveLength(2));
  });
});
