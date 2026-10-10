import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { t } from '@/i18n';
import type { ExperimentResults, ExperimentRow } from '@/lib/api/modules/analytics';
import { apiError, field, json, renderSignedIn } from '@/test/utils';
import { ExperimentDetailPage } from './ExperimentDetailPage';
import { ExperimentsPage } from './ExperimentsPage';

const draft: ExperimentRow = {
  id: 'e1', key: 'paywall_copy', surface: 'paywall', hypothesis: 'Benefit-led copy converts better', status: 'draft', segment_id: 's1',
  traffic_pct: 100, primary_metric: 'paywall_viewed', started_at: null, ended_at: null, created_by: 'a1',
  created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
  variants: [
    { id: 'v1', experiment_id: 'e1', key: 'control', allocation: 50, config: { headline: 'Go Premium' }, is_control: true },
    { id: 'v2', experiment_id: 'e1', key: 'benefits', allocation: 50, config: { headline: 'See who likes you' }, is_control: false },
  ],
};
const running: ExperimentRow = { ...draft, id: 'e2', key: 'onboarding_v2', surface: 'onboarding', status: 'running', segment_id: null, started_at: '2026-10-02T00:00:00Z', variants: draft.variants.map((v) => ({ ...v, experiment_id: 'e2' })) };
const segments = [{ id: 's1', key: 'beta', description: null, definition: { field: 'a', op: 'exists' }, updated_at: '2026-01-01T00:00:00Z' }];

const results: ExperimentResults = {
  key: 'onboarding_v2', status: 'running', surface: 'onboarding', primaryMetric: 'onboarding_completed', startedAt: '2026-10-02T00:00:00Z', endedAt: null,
  variants: [
    { key: 'benefits', isControl: false, allocation: 50, assigned: 1000, converted: 260, rate: 0.26, vsControl: { lift: 0.3, z: 3.2, pValue: 0.0004, ci95: [0.022, 0.098] } },
    { key: 'control', isControl: true, allocation: 50, assigned: 1000, converted: 200, rate: 0.2, vsControl: null },
  ],
};

describe('ExperimentsPage', () => {
  it('lists experiments and hides every mutation without experiments.manage', async () => {
    await renderSignedIn(<ExperimentsPage />, { 'GET /admin/analytics/experiments': () => [draft, running] }, ['analytics.view']);
    expect(await screen.findByText('paywall_copy')).toBeInTheDocument();
    expect(screen.getByText(t('analytics.experiments.statuses.running'))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: t('analytics.experiments.viewResultsFor', { key: 'onboarding_v2' }) })).toHaveAttribute('href', '/experiments/onboarding_v2');
    expect(screen.queryByRole('button', { name: t('analytics.experiments.newExperiment') })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: `${t('common.edit')} paywall_copy` })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Start|Pause/ })).not.toBeInTheDocument();
  });

  it('shows empty and error states', async () => {
    const user = userEvent.setup();
    let fail = true;
    await renderSignedIn(<ExperimentsPage />, { 'GET /admin/analytics/experiments': () => (fail ? apiError(503, 'INTERNAL') : []), 'GET /admin/config/segments': () => [] });
    expect(await screen.findByText(t('errors.INTERNAL'))).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: t('common.retry') }));
    expect(await screen.findByText(t('analytics.experiments.empty'))).toBeInTheDocument();
  });

  it('creates an experiment after validating allocations and the control', async () => {
    const user = userEvent.setup();
    const { mutations } = await renderSignedIn(<ExperimentsPage />, {
      'GET /admin/analytics/experiments': () => [],
      'GET /admin/config/segments': () => segments,
      'PUT /admin/analytics/experiments/home_feed.v1': () => ({ id: 'new' }),
    });
    await screen.findByText(t('analytics.experiments.empty'));
    await user.click(screen.getByRole('button', { name: t('analytics.experiments.newExperiment') }));
    const d = screen.getByRole('dialog');
    await user.type(field(t('analytics.experiments.key')), 'home_feed.v1');
    await user.selectOptions(within(d).getByLabelText(t('analytics.experiments.surface'), { exact: false }), 'discovery');
    await user.selectOptions(within(d).getByLabelText(t('analytics.experiments.primaryMetric'), { exact: false }), 'like_sent');
    await user.selectOptions(within(d).getByLabelText(t('analytics.experiments.segment')), 'beta');
    const allocations = within(d).getAllByLabelText(t('analytics.experiments.allocation'), { exact: false });
    await user.clear(allocations[1]!);
    await user.type(allocations[1]!, '40');
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    expect(within(d).getByText(t('analytics.experiments.allocationSum', { total: 90 }))).toBeInTheDocument();
    expect(mutations().some((c) => c.method === 'PUT')).toBe(false);

    await user.clear(allocations[1]!);
    await user.type(allocations[1]!, '50');
    const configs = within(d).getAllByLabelText(t('analytics.experiments.config'), { exact: false });
    await user.clear(configs[1]!);
    await user.type(configs[1]!, '{{"ranking":"fresh"}');
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    await waitFor(() => expect(mutations().some((c) => c.method === 'PUT')).toBe(true));
    expect(mutations().find((c) => c.method === 'PUT')!.body).toEqual({
      surface: 'discovery', segmentKey: 'beta', trafficPct: 100, primaryMetric: 'like_sent',
      variants: [
        { key: 'control', allocation: 50, isControl: true, config: {} },
        { key: 'treatment', allocation: 50, isControl: false, config: { ranking: 'fresh' } },
      ],
    });
    expect(await screen.findByText(t('analytics.experiments.saved'))).toBeInTheDocument();
  });

  it('edits a draft, keeping its segment key resolved from the segment id', async () => {
    const user = userEvent.setup();
    const { mutations } = await renderSignedIn(<ExperimentsPage />, {
      'GET /admin/analytics/experiments': () => [draft],
      'GET /admin/config/segments': () => segments,
      'PUT /admin/analytics/experiments/paywall_copy': () => ({ id: 'e1' }),
    });
    await user.click(await screen.findByRole('button', { name: `${t('common.edit')} paywall_copy` }));
    const d = screen.getByRole('dialog');
    expect(within(d).getByLabelText(t('analytics.experiments.segment'))).toHaveValue('beta');
    const traffic = within(d).getByLabelText(t('analytics.experiments.trafficPct'), { exact: false });
    await user.clear(traffic);
    await user.type(traffic, '25');
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    await waitFor(() => expect(mutations().some((c) => c.method === 'PUT')).toBe(true));
    expect(mutations().find((c) => c.method === 'PUT')!.body).toEqual({
      surface: 'paywall', hypothesis: 'Benefit-led copy converts better', segmentKey: 'beta', trafficPct: 25, primaryMetric: 'paywall_viewed',
      variants: [
        { key: 'control', allocation: 50, isControl: true, config: { headline: 'Go Premium' } },
        { key: 'benefits', allocation: 50, isControl: false, config: { headline: 'See who likes you' } },
      ],
    });
  });

  it('starts a draft after confirmation and requires the key to complete a running one', async () => {
    const user = userEvent.setup();
    const { mutations } = await renderSignedIn(<ExperimentsPage />, {
      'GET /admin/analytics/experiments': () => [draft, running],
      'GET /admin/config/segments': () => segments,
      'POST /admin/analytics/experiments/paywall_copy/running': () => json(204),
      'POST /admin/analytics/experiments/onboarding_v2/completed': () => json(204),
    });
    const transitions = () => mutations().filter((c) => c.path.startsWith('/admin/analytics/experiments/'));
    await user.click(await screen.findByRole('button', { name: t('analytics.experiments.actionFor', { action: t('analytics.experiments.actions.start'), key: 'paywall_copy' }) }));
    let d = screen.getByRole('dialog', { name: t('analytics.experiments.confirm.startTitle', { key: 'paywall_copy' }) });
    expect(transitions()).toHaveLength(0);
    await user.click(within(d).getByRole('button', { name: t('analytics.experiments.actions.start') }));
    await waitFor(() => expect(transitions()).toHaveLength(1));
    expect(transitions()[0]!.path).toBe('/admin/analytics/experiments/paywall_copy/running');

    // Running experiments offer pause/complete only (no edit); completing is irreversible.
    expect(screen.queryByRole('button', { name: `${t('common.edit')} onboarding_v2` })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('analytics.experiments.actionFor', { action: t('analytics.experiments.actions.complete'), key: 'onboarding_v2' }) }));
    d = screen.getByRole('dialog', { name: t('analytics.experiments.confirm.completeTitle', { key: 'onboarding_v2' }) });
    await user.click(within(d).getByRole('button', { name: t('analytics.experiments.actions.complete') }));
    expect(within(d).getByText(t('confirmText.mismatch'))).toBeInTheDocument();
    expect(transitions()).toHaveLength(1);
    await user.type(within(d).getByLabelText(t('confirmText.label', { phrase: 'onboarding_v2' }), { exact: false }), 'onboarding_v2');
    await user.click(within(d).getByRole('button', { name: t('analytics.experiments.actions.complete') }));
    await waitFor(() => expect(transitions()).toHaveLength(2));
    expect(transitions()[1]!.path).toBe('/admin/analytics/experiments/onboarding_v2/completed');
  });
});

describe('ExperimentDetailPage', () => {
  it('shows the definition and results with lift, CI, p-value and significance', async () => {
    await renderSignedIn(<ExperimentDetailPage experimentKey="onboarding_v2" />, {
      'GET /admin/analytics/experiments': () => [draft, running],
      'GET /admin/config/segments': () => segments,
      'GET /admin/analytics/experiments/onboarding_v2/results': () => results,
    });
    expect(await screen.findByText(t('analytics.experiments.results.significant'))).toBeInTheDocument();
    expect(screen.getByText(t('analytics.experiments.results.better'))).toBeInTheDocument();
    expect(screen.getByText('+30%')).toBeInTheDocument();
    expect(screen.getByText(t('analytics.experiments.results.ciRange', { low: '+2.2%', high: '+9.8%' }))).toBeInTheDocument();
    expect(screen.getByText(t('analytics.experiments.results.pBelow'))).toBeInTheDocument();
    expect(screen.getByText(t('analytics.experiments.results.baseline'))).toBeInTheDocument();
    expect(screen.getByText('26%')).toBeInTheDocument();
    expect(await screen.findByText(t('analytics.experiments.definition'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('analytics.experiments.actionFor', { action: t('analytics.experiments.actions.pause'), key: 'onboarding_v2' }) })).toBeInTheDocument();
  });

  it('marks non-significant and data-less comparisons and hides actions for viewers', async () => {
    const weak: ExperimentResults = {
      ...results,
      variants: [
        { key: 'a', isControl: false, allocation: 50, assigned: 100, converted: 21, rate: 0.21, vsControl: { lift: 0.05, z: 0.3, pValue: 0.76, ci95: [-0.1, 0.12] } },
        { key: 'b', isControl: false, allocation: 0, assigned: 0, converted: 0, rate: null, vsControl: { lift: null, z: null, pValue: null, ci95: null } },
        { key: 'control', isControl: true, allocation: 50, assigned: 100, converted: 20, rate: 0.2, vsControl: null },
      ],
    };
    await renderSignedIn(<ExperimentDetailPage experimentKey="onboarding_v2" />, {
      'GET /admin/analytics/experiments': () => [running],
      'GET /admin/analytics/experiments/onboarding_v2/results': () => weak,
    }, ['analytics.view']);
    expect(await screen.findByText(t('analytics.experiments.results.notSignificant'))).toBeInTheDocument();
    expect(screen.getByText(t('analytics.experiments.results.insufficient'))).toBeInTheDocument();
    await screen.findByText(t('analytics.experiments.definition'));
    expect(screen.queryByRole('button', { name: /Pause|Complete/ })).not.toBeInTheDocument();
  });

  it('reports an unknown key', async () => {
    await renderSignedIn(<ExperimentDetailPage experimentKey="nope" />, {
      'GET /admin/analytics/experiments': () => [draft],
      'GET /admin/config/segments': () => segments,
      'GET /admin/analytics/experiments/nope/results': () => apiError(404, 'NOT_FOUND'),
    });
    expect(await screen.findByText(t('analytics.experiments.notFound', { key: 'nope' }))).toBeInTheDocument();
  });
});
