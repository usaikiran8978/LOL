import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { t } from '@/i18n';
import { navigationState, routerMock } from '@/test/setup';
import { apiError, json, renderSignedIn } from '@/test/utils';
import { UserBillingPage } from './UserBillingPage';

const USER = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const PAID = '0b5c7a5e-1f53-4b8a-9c42-3a5e8d1f2b11';
const REFUNDED = '1c6d8b6f-2a64-4c9b-8d53-4b6f9e2a3c22';
const APPLE = '2d7e9c70-3b75-4dac-9e64-5c70af3b4d33';

const billing = {
  subscriptions: [{
    id: 's1', user_id: USER, product_id: 'p1', price_id: 'pr1', provider: 'stripe', provider_subscription_id: 'sub_1', provider_customer_id: 'cus_1', status: 'active',
    current_period_start: '2026-09-01T00:00:00Z', current_period_end: '2026-10-01T00:00:00Z', trial_end: null, cancel_at_period_end: true, canceled_at: null, pending_product_id: null,
    created_at: '2026-08-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
  }],
  payments: [
    { id: PAID, provider: 'stripe', kind: 'subscription', productKey: 'premium', amountMinor: 1999, currency: 'USD', status: 'partially_refunded', refundedMinor: 500, receiptUrl: 'https://pay.example/r/1', at: '2026-09-01T00:00:00Z' },
    { id: REFUNDED, provider: 'stripe', kind: 'consumable', productKey: 'boost_1', amountMinor: 399, currency: 'USD', status: 'refunded', refundedMinor: 399, receiptUrl: null, at: '2026-08-15T00:00:00Z' },
    { id: APPLE, provider: 'apple', kind: 'consumable', productKey: 'super_like_5', amountMinor: 499, currency: 'EUR', status: 'succeeded', refundedMinor: 0, receiptUrl: null, at: '2026-08-10T00:00:00Z' },
  ],
  entitlements: [{ id: 'e1', user_id: USER, entitlement_key: 'see_who_liked', source_type: 'subscription', source_id: 's1', limit_value: null, limit_period: null, starts_at: '2026-09-01T00:00:00Z', ends_at: null, revoked_at: null }],
  balances: [{ user_id: USER, item_key: 'boost', balance: 3, updated_at: '2026-09-01T00:00:00Z' }],
  ledger: [{ id: 'l1', user_id: USER, item_key: 'boost', delta: 2, reason: 'admin_adjustment', ref_id: null, created_at: '2026-09-02T00:00:00Z' }],
};
const products = [{ id: 'p1', key: 'premium', kind: 'subscription', tier: 'premium', rank: 1, is_active: true, consumable_item_key: null, consumable_quantity: null, created_at: '', updated_at: '', prices: [], entitlements: [], translations: {} }];

const handlers = (extra: Record<string, Parameters<typeof renderSignedIn>[1][string]> = {}) => ({
  [`GET /admin/billing/users/${USER}`]: () => billing,
  'GET /admin/billing/products': () => products,
  ...extra,
});

afterEach(() => {
  navigationState.search = '';
});

async function lookUp(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(t('billing.users.userId'), { exact: false }), USER);
  await user.click(screen.getByRole('button', { name: t('billing.users.lookup') }));
  await screen.findByText(t('billing.users.subscriptions'));
}

describe('UserBillingPage', () => {
  it('prompts for a user ID and validates it before calling the API', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<UserBillingPage />, handlers());
    expect(screen.getByText(t('billing.users.prompt'))).toBeInTheDocument();
    await user.type(screen.getByLabelText(t('billing.users.userId'), { exact: false }), 'not-a-uuid');
    await user.click(screen.getByRole('button', { name: t('billing.users.lookup') }));
    expect(screen.getByText(t('validation.invalidUuid'))).toBeInTheDocument();
    expect(calls.some((c) => c.path.startsWith('/admin/billing/users'))).toBe(false);
  });

  it('looks up a user and shows subscriptions, payments, entitlements, balances and ledger', async () => {
    const user = userEvent.setup();
    routerMock.replace.mockClear();
    await renderSignedIn(<UserBillingPage />, handlers());
    await lookUp(user);
    expect(routerMock.replace).toHaveBeenCalledWith(`/billing/users?userId=${USER}`);
    const subs = screen.getByRole('region', { name: t('billing.users.subscriptions') });
    expect(within(subs).getByText('premium')).toBeInTheDocument();
    expect(within(subs).getByText(t('billing.users.subscriptionStatus.active'))).toBeInTheDocument();
    const payments = screen.getByRole('region', { name: t('billing.users.payments') });
    expect(within(payments).getByText('$19.99')).toBeInTheDocument();
    expect(within(payments).getByText('$5.00')).toBeInTheDocument();
    expect(within(payments).getByText('€4.99')).toBeInTheDocument();
    expect(within(payments).getByText(t('billing.users.paymentStatus.partially_refunded'))).toBeInTheDocument();
    expect(within(payments).getByRole('link', { name: t('billing.users.openReceipt') })).toHaveAttribute('href', 'https://pay.example/r/1');
    expect(screen.getByText(t('billing.entitlementKeys.see_who_liked'))).toBeInTheDocument();
    expect(screen.getByText('+2')).toBeInTheDocument();
    expect(screen.getByText(t('billing.users.ledgerReasons.admin_adjustment'))).toBeInTheDocument();
  });

  it('loads the user from the URL and shows empty sections', async () => {
    navigationState.search = `userId=${USER}`;
    await renderSignedIn(<UserBillingPage />, handlers({ [`GET /admin/billing/users/${USER}`]: () => ({ subscriptions: [], payments: [], entitlements: [], balances: [], ledger: [] }) }));
    expect(await screen.findByText(t('billing.users.noSubscriptions'))).toBeInTheDocument();
    expect(screen.getByText(t('billing.users.noPayments'))).toBeInTheDocument();
    expect(screen.getByText(t('billing.users.noLedger'))).toBeInTheDocument();
  });

  it('shows the lookup error and retries', async () => {
    const user = userEvent.setup();
    let n = 0;
    navigationState.search = `userId=${USER}`;
    await renderSignedIn(<UserBillingPage />, handlers({ [`GET /admin/billing/users/${USER}`]: () => (n++ === 0 ? apiError(500, 'INTERNAL') : billing) }));
    await user.click(await screen.findByRole('button', { name: t('common.retry') }));
    expect(await screen.findByText(t('billing.users.subscriptions'))).toBeInTheDocument();
  });

  it('offers refunds only for refundable payments and only with billing.refund', async () => {
    const user = userEvent.setup();
    await renderSignedIn(<UserBillingPage />, handlers());
    await lookUp(user);
    expect(screen.getByRole('button', { name: t('billing.users.refundPayment', { id: PAID }) })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('billing.users.refundPayment', { id: APPLE }) })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('billing.users.refundPayment', { id: REFUNDED }) })).not.toBeInTheDocument();
  });

  it('hides refund and grant actions without their permissions', async () => {
    const user = userEvent.setup();
    await renderSignedIn(<UserBillingPage />, handlers(), ['billing.view']);
    await lookUp(user);
    expect(screen.queryByRole('button', { name: t('billing.users.refundPayment', { id: PAID }) })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('billing.users.grant') })).not.toBeInTheDocument();
  });

  it('refunds a partial amount only after the typed confirmation', async () => {
    const user = userEvent.setup();
    const { mutations } = await renderSignedIn(<UserBillingPage />, handlers({ [`POST /admin/billing/payments/${PAID}/refund`]: () => ({ status: 'succeeded', refundId: 're_1' }) }));
    await lookUp(user);
    await user.click(screen.getByRole('button', { name: t('billing.users.refundPayment', { id: PAID }) }));
    const d = screen.getByRole('dialog', { name: t('billing.refund.title') });
    expect(within(d).getByText('$14.99')).toBeInTheDocument();
    expect(within(d).getByText(t('billing.refund.amountHint', { amount: '$14.99' }))).toBeInTheDocument();
    const amount = within(d).getByLabelText(t('billing.refund.amountMinor'));
    await user.type(amount, '2000');
    await user.type(within(d).getByLabelText(t('billing.refund.reason'), { exact: false }), 'goodwill');
    const phrase = within(d).getByLabelText(t('confirmText.label', { phrase: t('billing.refund.phrase') }), { exact: false });
    await user.type(phrase, 'refund');
    await user.click(within(d).getByRole('button', { name: t('billing.refund.confirm', { amount: '$20.00' }) }));
    expect(within(d).getByText(t('confirmText.mismatch'))).toBeInTheDocument();
    await user.clear(phrase);
    await user.type(phrase, t('billing.refund.phrase'));
    await user.click(within(d).getByRole('button', { name: t('billing.refund.confirm', { amount: '$20.00' }) }));
    expect(within(d).getByText(t('billing.refund.tooMuch', { amount: '$14.99' }))).toBeInTheDocument();
    expect(mutations().filter((c) => c.path.includes('/refund'))).toHaveLength(0);
    await user.clear(amount);
    await user.type(amount, '500');
    await user.click(within(d).getByRole('button', { name: t('billing.refund.confirm', { amount: '$5.00' }) }));
    await waitFor(() => expect(mutations().some((c) => c.path === `/admin/billing/payments/${PAID}/refund`)).toBe(true));
    expect(mutations().find((c) => c.path.includes('/refund'))!.body).toEqual({ amountMinor: 500, reason: 'goodwill' });
    expect(await screen.findByText(t('billing.refund.doneStripe', { amount: '$5.00', status: 'succeeded' }))).toBeInTheDocument();
  });

  it('records a store refund request and shows store instructions', async () => {
    const user = userEvent.setup();
    const { mutations } = await renderSignedIn(<UserBillingPage />, handlers({ [`POST /admin/billing/payments/${APPLE}/refund`]: () => ({ status: 'requested', instructions: 'Apple…' }) }));
    await lookUp(user);
    await user.click(screen.getByRole('button', { name: t('billing.users.refundPayment', { id: APPLE }) }));
    const d = screen.getByRole('dialog', { name: t('billing.refund.title') });
    await user.type(within(d).getByLabelText(t('billing.refund.reason'), { exact: false }), 'duplicate purchase');
    await user.type(within(d).getByLabelText(t('confirmText.label', { phrase: t('billing.refund.phrase') }), { exact: false }), t('billing.refund.phrase'));
    await user.click(within(d).getByRole('button', { name: t('billing.refund.confirm', { amount: '€4.99' }) }));
    await waitFor(() => expect(mutations().some((c) => c.path.includes('/refund'))).toBe(true));
    expect(mutations().find((c) => c.path.includes('/refund'))!.body).toEqual({ reason: 'duplicate purchase' });
    expect(await screen.findByText(t('billing.refund.doneApple'))).toBeInTheDocument();
  });

  it('keeps the refund dialog open with the API error', async () => {
    const user = userEvent.setup();
    await renderSignedIn(<UserBillingPage />, handlers({ [`POST /admin/billing/payments/${APPLE}/refund`]: () => apiError(409, 'CONFLICT') }));
    await lookUp(user);
    await user.click(screen.getByRole('button', { name: t('billing.users.refundPayment', { id: APPLE }) }));
    const d = screen.getByRole('dialog', { name: t('billing.refund.title') });
    await user.type(within(d).getByLabelText(t('billing.refund.reason'), { exact: false }), 'x');
    await user.type(within(d).getByLabelText(t('confirmText.label', { phrase: t('billing.refund.phrase') }), { exact: false }), t('billing.refund.phrase'));
    await user.click(within(d).getByRole('button', { name: t('billing.refund.confirm', { amount: '€4.99' }) }));
    expect(await within(d).findByText(t('errors.CONFLICT'))).toBeInTheDocument();
  });

  it('grants a consumable to the user', async () => {
    const user = userEvent.setup();
    const { mutations } = await renderSignedIn(<UserBillingPage />, handlers({ 'POST /admin/billing/grants': () => json(204) }));
    await lookUp(user);
    await user.click(screen.getByRole('button', { name: t('billing.users.grant') }));
    const d = screen.getByRole('dialog', { name: t('billing.grant.title') });
    await user.click(within(d).getByRole('button', { name: t('billing.grant.submit') }));
    expect(within(d).getAllByText(t('validation.required')).length).toBeGreaterThan(0);
    expect(mutations().some((c) => c.path === '/admin/billing/grants')).toBe(false);
    await user.selectOptions(within(d).getByLabelText(t('billing.grant.type'), { exact: false }), 'consumable');
    await user.selectOptions(within(d).getByLabelText(t('billing.grant.item'), { exact: false }), 'boost');
    await user.type(within(d).getByLabelText(t('billing.grant.quantity'), { exact: false }), '2');
    await user.type(within(d).getByLabelText(t('billing.grant.reasonKey'), { exact: false }), 'support_goodwill');
    await user.click(within(d).getByRole('button', { name: t('billing.grant.submit') }));
    await waitFor(() => expect(mutations().some((c) => c.path === '/admin/billing/grants')).toBe(true));
    expect(mutations().find((c) => c.path === '/admin/billing/grants')!.body).toEqual({ userId: USER, consumable: { itemKey: 'boost', quantity: 2 }, reasonKey: 'support_goodwill' });
    expect(await screen.findByText(t('billing.grant.done'))).toBeInTheDocument();
  });

  it('grants a time-limited entitlement', async () => {
    const user = userEvent.setup();
    const { mutations } = await renderSignedIn(<UserBillingPage />, handlers({ 'POST /admin/billing/grants': () => json(204) }));
    await lookUp(user);
    await user.click(screen.getByRole('button', { name: t('billing.users.grant') }));
    const d = screen.getByRole('dialog', { name: t('billing.grant.title') });
    await user.selectOptions(within(d).getByLabelText(t('billing.grant.entitlement'), { exact: false }), 'incognito');
    await user.type(within(d).getByLabelText(t('billing.grant.days')), '30');
    await user.type(within(d).getByLabelText(t('billing.grant.reasonKey'), { exact: false }), 'Bad Key');
    await user.click(within(d).getByRole('button', { name: t('billing.grant.submit') }));
    expect(within(d).getByText(t('validation.invalidFormat'))).toBeInTheDocument();
    await user.clear(within(d).getByLabelText(t('billing.grant.reasonKey'), { exact: false }));
    await user.type(within(d).getByLabelText(t('billing.grant.reasonKey'), { exact: false }), 'vip_trial');
    await user.click(within(d).getByRole('button', { name: t('billing.grant.submit') }));
    await waitFor(() => expect(mutations().some((c) => c.path === '/admin/billing/grants')).toBe(true));
    expect(mutations().find((c) => c.path === '/admin/billing/grants')!.body).toEqual({ userId: USER, entitlementKey: 'incognito', days: 30, reasonKey: 'vip_trial' });
  });
});
