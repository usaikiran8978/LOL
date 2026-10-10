import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { t } from '@/i18n';
import { apiError, json, renderSignedIn } from '@/test/utils';
import { WebhooksPage } from './WebhooksPage';

const FAILED_ID = '3e8fad81-4c86-4ebd-8f75-6d81b04c5e44';
const failed = { id: FAILED_ID, provider: 'stripe', provider_event_id: 'evt_failed', event_type: 'invoice.paid', received_at: '2026-09-01T00:00:00Z', processed_at: null, attempts: 3, last_error: 'boom' };
const done = { id: 'w2', provider: 'apple', provider_event_id: 'evt_ok', event_type: 'DID_RENEW', received_at: '2026-09-02T00:00:00Z', processed_at: '2026-09-02T00:00:01Z', attempts: 1, last_error: null };
const pending = { id: 'w3', provider: 'google', provider_event_id: 'evt_new', event_type: 'SUBSCRIPTION_PURCHASED', received_at: '2026-09-03T00:00:00Z', processed_at: null, attempts: 0, last_error: null };

describe('WebhooksPage', () => {
  it('lists events with their processing state', async () => {
    const { calls } = await renderSignedIn(<WebhooksPage />, { 'GET /admin/billing/webhooks': () => [pending, done, failed] });
    expect(await screen.findByText('evt_failed')).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/admin/billing/webhooks')!.query.get('limit')).toBe('100');
    expect(calls.find((c) => c.path === '/admin/billing/webhooks')!.query.has('failed')).toBe(false);
    expect(screen.getByText(t('billing.webhooks.states.failed'))).toBeInTheDocument();
    expect(screen.getByText(t('billing.webhooks.states.processed'))).toBeInTheDocument();
    expect(screen.getByText(t('billing.webhooks.states.pending'))).toBeInTheDocument();
    expect(screen.getByText('boom')).toBeInTheDocument();
  });

  it('filters to failed events', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<WebhooksPage />, { 'GET /admin/billing/webhooks': (c) => (c.query.get('failed') === 'true' ? [] : [done]) });
    expect(await screen.findByText('evt_ok')).toBeInTheDocument();
    await user.click(screen.getByLabelText(t('billing.webhooks.failedOnly')));
    expect(await screen.findByText(t('billing.webhooks.emptyFailed'))).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/admin/billing/webhooks' && c.query.get('failed') === 'true')).toBe(true);
  });

  it('shows the error and retries', async () => {
    const user = userEvent.setup();
    let n = 0;
    await renderSignedIn(<WebhooksPage />, { 'GET /admin/billing/webhooks': () => (n++ === 0 ? apiError(500, 'INTERNAL') : []) });
    await user.click(await screen.findByRole('button', { name: t('common.retry') }));
    expect(await screen.findByText(t('billing.webhooks.empty'))).toBeInTheDocument();
  });

  it('replays an event after confirmation', async () => {
    const user = userEvent.setup();
    const { mutations } = await renderSignedIn(<WebhooksPage />, {
      'GET /admin/billing/webhooks': () => [failed],
      [`POST /admin/billing/webhooks/${FAILED_ID}/replay`]: () => json(204),
    });
    await user.click(await screen.findByRole('button', { name: t('billing.webhooks.replayEvent', { id: 'evt_failed' }) }));
    const d = screen.getByRole('dialog', { name: t('billing.webhooks.replayTitle') });
    expect(mutations()).toHaveLength(1); // the auto-login only
    await user.click(within(d).getByRole('button', { name: t('billing.webhooks.replay') }));
    await waitFor(() => expect(mutations().some((c) => c.path === `/admin/billing/webhooks/${FAILED_ID}/replay`)).toBe(true));
    expect(await screen.findByText(t('billing.webhooks.replayed'))).toBeInTheDocument();
  });

  it('hides replay without billing.plans.manage', async () => {
    await renderSignedIn(<WebhooksPage />, { 'GET /admin/billing/webhooks': () => [failed] }, ['billing.view']);
    expect(await screen.findByText('evt_failed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('billing.webhooks.replayEvent', { id: 'evt_failed' }) })).not.toBeInTheDocument();
  });
});
