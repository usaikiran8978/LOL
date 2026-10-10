import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { t } from '@/i18n';
import { apiError, renderSignedIn } from '@/test/utils';
import { usage } from './fixtures.test-data';
import { UsagePage } from './UsagePage';
import { formatUsd } from './shared';

describe('UsagePage', () => {
  it('shows totals, per-feature and per-day aggregates and the detail rows', async () => {
    const { calls } = await renderSignedIn(<UsagePage />, { 'GET /admin/ai/usage': () => usage() });
    const requestsKpi = (await screen.findAllByText(t('ai.usage.requests')))[0]!.closest('.kpi')!;
    expect(within(requestsKpi as HTMLElement).getByText('20')).toBeInTheDocument();
    const costKpi = screen.getAllByText(t('ai.usage.cost'))[0]!.closest('.kpi') as HTMLElement;
    expect(within(costKpi).getByText(formatUsd(0.5))).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/admin/ai/usage')!.query.get('days')).toBe('14');
    expect(within(screen.getByRole('navigation', { name: t('ai.tabs.label') })).getAllByRole('link')).toHaveLength(4);

    const byFeature = screen.getByRole('table', { name: t('ai.usage.byFeature') });
    const coachRow = within(byFeature).getByRole('rowheader', { name: t('ai.featureNames.profile_coach') }).closest('tr')!;
    expect(within(coachRow).getByText('16')).toBeInTheDocument();
    expect(within(coachRow).getByText(formatUsd(0.45))).toBeInTheDocument();
    const byDay = screen.getByRole('table', { name: t('ai.usage.byDay') });
    expect(within(byDay).getAllByRole('row')).toHaveLength(3);
    const detail = screen.getByRole('table', { name: t('ai.usage.detail') });
    expect(within(detail).getAllByRole('row')).toHaveLength(4);
  });

  it('changes the period', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<UsagePage />, { 'GET /admin/ai/usage': () => [] });
    expect(await screen.findByText(t('ai.usage.empty'))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('ai.usage.lastDays', { days: 30 }) }));
    await waitFor(() => expect(calls.filter((c) => c.path === '/admin/ai/usage').map((c) => c.query.get('days'))).toEqual(['14', '30']));
    expect(screen.getByRole('button', { name: t('ai.usage.lastDays', { days: 30 }) })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows an error with retry', async () => {
    const user = userEvent.setup();
    let fail = true;
    await renderSignedIn(<UsagePage />, { 'GET /admin/ai/usage': () => (fail ? apiError(500, 'INTERNAL') : usage()) });
    expect(await screen.findByText(t('states.errorTitle'))).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: t('common.retry') }));
    expect(await screen.findByRole('table', { name: t('ai.usage.byFeature') })).toBeInTheDocument();
  });
});
