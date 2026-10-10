import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '@/i18n';
import { downloadText } from '@/lib/download';
import { apiError, renderSignedIn } from '@/test/utils';
import { DashboardPage } from './DashboardPage';

vi.mock('@/lib/download', () => ({ downloadText: vi.fn() }));

const definitions = {
  registrations: { label: 'Registrations', unit: 'count' },
  match_rate: { label: 'Match rate', unit: 'ratio' },
  revenue: { label: 'Net revenue', unit: 'minor_currency' },
  dau: { label: 'Daily active users', unit: 'count' },
};
const dashboard = {
  definitions,
  live: { total_users: 1234, active_users: 56, premium: 7, open_cases: 3, breached: 1 },
  series: {
    registrations: [{ date: '2026-10-06', dimension: 'all', value: 10 }, { date: '2026-10-07', dimension: 'all', value: 14 }],
    match_rate: [{ date: '2026-10-07', dimension: 'all', value: 0.25 }],
    revenue: [{ date: '2026-10-07', dimension: 'currency:USD', value: 12345 }, { date: '2026-10-07', dimension: 'currency:EUR', value: 500 }],
  },
};

beforeEach(() => vi.mocked(downloadText).mockClear());

describe('DashboardPage', () => {
  it('shows live counters, latest values and a chart with a data-table alternative', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<DashboardPage />, { 'GET /admin/analytics/dashboard': () => dashboard });
    expect(screen.getByText(t('app.loading'))).toBeInTheDocument();
    expect(await screen.findByText(t('dashboard.live.total_users'))).toBeInTheDocument();
    expect(screen.getByText('1,234')).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/admin/analytics/dashboard')!.query.get('days')).toBe('30');

    // Default trend is registrations; the SVG has an accessible name and a text summary.
    const chart = screen.getByRole('img', { name: /Registrations/ });
    expect(chart).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('analytics.chart.showTable') }));
    const table = screen.getByRole('table', { name: t('analytics.metrics.registrations') });
    expect(within(table).getByText('14')).toBeInTheDocument();

    // Latest values: ratio as percent, money per currency.
    expect(screen.getByText('25%')).toBeInTheDocument();
    expect(screen.getByText('$123.45')).toBeInTheDocument();

    // Selecting a multi-currency metric charts one line per currency with a legend.
    await user.click(screen.getByRole('button', { name: t('dashboard.latest.showFor', { metric: t('analytics.metrics.revenue') }) }));
    const legend = screen.getByRole('list', { name: t('analytics.chart.legend') });
    expect(within(legend).getByText('USD')).toBeInTheDocument();
    expect(within(legend).getByText('EUR')).toBeInTheDocument();
  });

  it('reloads with the chosen range', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<DashboardPage />, { 'GET /admin/analytics/dashboard': () => dashboard });
    await screen.findByText(t('dashboard.live.total_users'));
    await user.click(screen.getByRole('button', { name: t('dashboard.rangeDays', { days: 7 }) }));
    await waitFor(() => expect(calls.filter((c) => c.path === '/admin/analytics/dashboard').at(-1)!.query.get('days')).toBe('7'));
    expect(screen.getByRole('button', { name: t('dashboard.rangeDays', { days: 7 }) })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows the empty state and hides export without analytics.export', async () => {
    await renderSignedIn(<DashboardPage />, { 'GET /admin/analytics/dashboard': () => ({ definitions, live: dashboard.live, series: {} }) }, ['dashboard.view']);
    expect(await screen.findByText(t('dashboard.empty'))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /CSV/ })).not.toBeInTheDocument();
  });

  it('shows the error with retry', async () => {
    const user = userEvent.setup();
    let fail = true;
    await renderSignedIn(<DashboardPage />, { 'GET /admin/analytics/dashboard': () => (fail ? apiError(500, 'INTERNAL') : dashboard) });
    expect(await screen.findByText(t('errors.INTERNAL'))).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: t('common.retry') }));
    expect(await screen.findByText(t('dashboard.live.total_users'))).toBeInTheDocument();
  });

  it('exports the dashboard window as CSV through the audited export endpoint', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<DashboardPage />, {
      'GET /admin/analytics/dashboard': () => dashboard,
      'GET /admin/analytics/export.csv': () => new Response('date,metric,dimension,value\n2026-10-07,registrations,all,14', { status: 200, headers: { 'Content-Type': 'text/csv' } }),
    });
    await screen.findByText(t('dashboard.live.total_users'));
    await user.click(screen.getByRole('button', { name: t('dashboard.exportLabel', { days: 30 }) }));
    await waitFor(() => expect(downloadText).toHaveBeenCalled());
    const call = calls.find((c) => c.path === '/admin/analytics/export.csv')!;
    const from = call.query.get('from')!;
    const to = call.query.get('to')!;
    expect(Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)).toBe(30 * 86_400_000);
    expect(vi.mocked(downloadText).mock.calls[0]![0]).toContain('registrations,all,14');
    expect(vi.mocked(downloadText).mock.calls[0]![1]).toBe(`metrics_${from}_${to}.csv`);
    expect(await screen.findByText(t('dashboard.exported'))).toBeInTheDocument();
  });
});
