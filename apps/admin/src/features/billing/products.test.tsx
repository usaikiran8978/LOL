import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { t } from '@/i18n';
import { navigationState, routerMock } from '@/test/setup';
import { apiError, renderSignedIn } from '@/test/utils';
import { BillingIndex } from './BillingIndex';
import { PricesPage } from './PricesPage';
import { ProductsPage } from './ProductsPage';

const premium = {
  id: 'p1', key: 'premium', kind: 'subscription', tier: 'premium', rank: 10, is_active: true, consumable_item_key: null, consumable_quantity: null,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  prices: [
    { id: 'pr1', product_id: 'p1', provider: 'stripe', provider_price_id: 'price_premium_month', currency: 'USD', amount_minor: '1999', billing_interval: 'month', interval_count: 1, trial_days: 7, quantity: 1, country_codes: null, is_active: true },
    { id: 'pr2', product_id: 'p1', provider: 'apple', provider_price_id: 'com.amora.premium.3m', currency: 'EUR', amount_minor: '4999', billing_interval: 'month', interval_count: 3, trial_days: 0, quantity: 1, country_codes: ['DE', 'FR'], is_active: false },
  ],
  entitlements: [
    { product_id: 'p1', entitlement_key: 'see_who_liked', limit_value: null, limit_period: null },
    { product_id: 'p1', entitlement_key: 'super_likes', limit_value: 5, limit_period: 'week' },
  ],
  translations: { en: { name: 'Amora Premium', description: 'All the extras' }, de: { name: 'Amora Premium DE', description: null } },
};
const boost = {
  id: 'p2', key: 'boost_1', kind: 'consumable', tier: null, rank: 0, is_active: true, consumable_item_key: 'boost', consumable_quantity: 1,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', prices: [], entitlements: [], translations: { en: { name: 'One boost', description: null } },
};

const entitlementSelect = new RegExp(`^${t('billing.entitlementEditor.key')}( \\*)?$`);

afterEach(() => {
  navigationState.search = '';
  navigationState.pathname = '/';
});

describe('ProductsPage', () => {
  it('lists products with names, grants and price counts', async () => {
    await renderSignedIn(<ProductsPage />, { 'GET /admin/billing/products': () => [premium, boost] });
    expect(await screen.findByText('Amora Premium')).toBeInTheDocument();
    expect(screen.getByText(`${t('billing.entitlementKeys.see_who_liked')}, ${t('billing.entitlementKeys.super_likes')} (5, ${t('billing.periods.week')})`)).toBeInTheDocument();
    expect(screen.getByText(`1 × ${t('billing.items.boost')}`)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: t('billing.products.managePricesFor', { key: 'premium' }) })).toHaveAttribute('href', '/billing/prices?product=premium');
    expect(screen.getByRole('button', { name: t('billing.products.newProduct') })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `${t('common.edit')} premium` })).toBeInTheDocument();
  });

  it('shows the empty state', async () => {
    await renderSignedIn(<ProductsPage />, { 'GET /admin/billing/products': () => [] });
    expect(await screen.findByText(t('billing.products.empty'))).toBeInTheDocument();
  });

  it('shows the error and retries', async () => {
    const user = userEvent.setup();
    let n = 0;
    await renderSignedIn(<ProductsPage />, { 'GET /admin/billing/products': () => (n++ === 0 ? apiError(500, 'INTERNAL') : [premium]) });
    expect(await screen.findByText(t('errors.INTERNAL'))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('common.retry') }));
    expect(await screen.findByText('Amora Premium')).toBeInTheDocument();
  });

  it('is read-only without billing.plans.manage', async () => {
    await renderSignedIn(<ProductsPage />, { 'GET /admin/billing/products': () => [premium] }, ['billing.view']);
    expect(await screen.findByText('Amora Premium')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('billing.products.newProduct') })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: `${t('common.edit')} premium` })).not.toBeInTheDocument();
  });

  it('is forbidden without billing.view and never calls the API', async () => {
    const { calls } = await renderSignedIn(<ProductsPage />, {}, ['billing.plans.manage']);
    expect(screen.getByText(t('states.forbiddenTitle'))).toBeInTheDocument();
    expect(calls.some((c) => c.path.startsWith('/admin/billing'))).toBe(false);
  });

  it('creates a subscription plan with entitlements after confirmation', async () => {
    const user = userEvent.setup();
    const { calls, mutations } = await renderSignedIn(<ProductsPage />, { 'GET /admin/billing/products': () => [], 'PUT /admin/billing/products/gold': (c) => c.body });
    await user.click(await screen.findByRole('button', { name: t('billing.products.newProduct') }));
    const d = screen.getByRole('dialog');
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    expect(within(d).getByText(t('validation.formHasErrors', { count: 2 }))).toBeInTheDocument();
    await user.type(within(d).getByLabelText(t('billing.products.key'), { exact: false }), 'gold');
    await user.selectOptions(within(d).getByLabelText(t('billing.products.tier')), 'premium_plus');
    await user.clear(within(d).getByLabelText(t('billing.products.rank'), { exact: false }));
    await user.type(within(d).getByLabelText(t('billing.products.rank'), { exact: false }), '30');
    await user.type(within(d).getByLabelText(`${t('billing.products.nameField')} (en)`, { exact: false }), 'Gold');
    await user.click(within(d).getByRole('button', { name: t('billing.entitlementEditor.add') }));
    await user.click(within(d).getByRole('button', { name: t('billing.entitlementEditor.add') }));
    const [first, second] = within(d).getAllByRole('combobox', { name: entitlementSelect });
    await user.selectOptions(first!, 'likes');
    await user.selectOptions(second!, 'likes');
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    expect(within(d).getByText(t('validation.duplicate', { value: 'likes' }))).toBeInTheDocument();
    await user.selectOptions(second!, 'incognito');
    await user.type(within(d).getAllByLabelText(t('billing.entitlementEditor.limit'))[0]!, '100');
    await user.selectOptions(within(d).getAllByLabelText(t('billing.entitlementEditor.period'))[0]!, 'day');
    await user.click(within(d).getByRole('button', { name: t('common.save') }));

    const confirm = screen.getByRole('dialog', { name: t('billing.confirmLiveTitle') });
    expect(mutations().some((c) => c.method === 'PUT')).toBe(false);
    await user.click(within(confirm).getByRole('button', { name: t('billing.confirmLiveAction') }));
    await waitFor(() => expect(mutations().some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({
      key: 'gold', kind: 'subscription', tier: 'premium_plus', rank: 30, isActive: true,
      translations: { en: { name: 'Gold' } },
      entitlements: [{ key: 'likes', limit: 100, period: 'day' }, { key: 'incognito', limit: null, period: null }],
      consumableGrant: null,
    });
    expect(await screen.findByText(t('common.saved'))).toBeInTheDocument();
  });

  it('requires a consumable grant for consumables', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<ProductsPage />, { 'GET /admin/billing/products': () => [], 'PUT /admin/billing/products/super_like_5': (c) => c.body });
    await user.click(await screen.findByRole('button', { name: t('billing.products.newProduct') }));
    const d = screen.getByRole('dialog');
    await user.type(within(d).getByLabelText(t('billing.products.key'), { exact: false }), 'super_like_5');
    await user.selectOptions(within(d).getByLabelText(t('billing.products.kind'), { exact: false }), 'consumable');
    await user.type(within(d).getByLabelText(`${t('billing.products.nameField')} (en)`, { exact: false }), '5 Super likes');
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    expect(within(d).getAllByText(t('validation.invalidOption')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('dialog', { name: t('billing.confirmLiveTitle') })).not.toBeInTheDocument();
    await user.selectOptions(within(d).getByLabelText(t('billing.products.consumableItem'), { exact: false }), 'super_like');
    await user.type(within(d).getByLabelText(t('billing.products.consumableQuantity'), { exact: false }), '5');
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    await user.click(within(screen.getByRole('dialog', { name: t('billing.confirmLiveTitle') })).getByRole('button', { name: t('billing.confirmLiveAction') }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')!.body).toMatchObject({ kind: 'consumable', tier: null, consumableGrant: { itemKey: 'super_like', quantity: 5 } });
  });

  it('edits an existing product keeping translations and entitlements, and maps server field errors', async () => {
    const user = userEvent.setup();
    let attempt = 0;
    const { calls } = await renderSignedIn(<ProductsPage />, {
      'GET /admin/billing/products': () => [premium],
      'PUT /admin/billing/products/premium': (c) => (attempt++ === 0 ? apiError(400, 'VALIDATION_FAILED', [{ path: 'rank', code: 'too_small', message: 'x' }]) : c.body),
    });
    await user.click(await screen.findByRole('button', { name: `${t('common.edit')} premium` }));
    const d = screen.getByRole('dialog', { name: t('billing.products.editProduct', { key: 'premium' }) });
    expect(within(d).getByLabelText(t('billing.products.key'))).toHaveValue('premium');
    expect(within(d).getByLabelText(t('billing.products.key'))).toHaveAttribute('readonly');
    expect(within(d).getAllByRole('combobox', { name: entitlementSelect })).toHaveLength(2);
    await user.click(within(d).getByLabelText(t('billing.products.active')));
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    await user.click(within(screen.getByRole('dialog', { name: t('billing.confirmLiveTitle') })).getByRole('button', { name: t('billing.confirmLiveAction') }));
    expect(await within(d).findByText(t('validation.invalid'))).toBeInTheDocument();

    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    await user.click(within(screen.getByRole('dialog', { name: t('billing.confirmLiveTitle') })).getByRole('button', { name: t('billing.confirmLiveAction') }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(2));
    expect(calls.filter((c) => c.method === 'PUT')[1]!.body).toEqual({
      key: 'premium', kind: 'subscription', tier: 'premium', rank: 10, isActive: false,
      translations: { en: { name: 'Amora Premium', description: 'All the extras' }, de: { name: 'Amora Premium DE' } },
      entitlements: [{ key: 'see_who_liked', limit: null, period: null }, { key: 'super_likes', limit: 5, period: 'week' }],
      consumableGrant: null,
    });
  });
});

describe('BillingIndex', () => {
  it('shows the catalogue to billing viewers', async () => {
    await renderSignedIn(<BillingIndex />, { 'GET /admin/billing/products': () => [premium] }, ['billing.view']);
    expect(await screen.findByText('Amora Premium')).toBeInTheDocument();
  });

  it('sends coupon-only admins to the coupons page', async () => {
    routerMock.replace.mockClear();
    await renderSignedIn(<BillingIndex />, {}, ['billing.coupons.manage']);
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/billing/coupons'));
  });

  it('shows section tabs filtered by permission', async () => {
    await renderSignedIn(<BillingIndex />, { 'GET /admin/billing/products': () => [] }, ['billing.view']);
    const nav = await screen.findByRole('navigation', { name: t('billing.sectionsLabel') });
    expect(within(nav).getByRole('link', { name: t('billing.tabs.webhooks') })).toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: t('billing.tabs.coupons') })).not.toBeInTheDocument();
  });
});

describe('PricesPage', () => {
  it('shows prices of the product from the URL with formatted amounts', async () => {
    navigationState.search = 'product=premium';
    await renderSignedIn(<PricesPage />, { 'GET /admin/billing/products': () => [boost, premium] });
    expect(await screen.findByText('price_premium_month')).toBeInTheDocument();
    expect(screen.getByText('$19.99')).toBeInTheDocument();
    expect(screen.getByText('€49.99')).toBeInTheDocument();
    expect(screen.getByText(t('billing.prices.every', { count: 3, interval: t('billing.intervals.month') }))).toBeInTheDocument();
    expect(screen.getByText('DE, FR')).toBeInTheDocument();
  });

  it('switches products and shows the empty state', async () => {
    const user = userEvent.setup();
    routerMock.replace.mockClear();
    await renderSignedIn(<PricesPage />, { 'GET /admin/billing/products': () => [premium, boost] });
    expect(await screen.findByText('price_premium_month')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText(t('billing.prices.product')), 'boost_1');
    expect(screen.getByText(t('billing.prices.empty'))).toBeInTheDocument();
    expect(routerMock.replace).toHaveBeenCalledWith('/billing/prices?product=boost_1');
  });

  it('shows a hint when there are no products', async () => {
    await renderSignedIn(<PricesPage />, { 'GET /admin/billing/products': () => [] });
    expect(await screen.findByText(t('billing.prices.noProducts'))).toBeInTheDocument();
  });

  it('hides price editing without billing.plans.manage', async () => {
    await renderSignedIn(<PricesPage />, { 'GET /admin/billing/products': () => [premium] }, ['billing.view']);
    expect(await screen.findByText('price_premium_month')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('billing.prices.newPrice') })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: `${t('common.edit')} price_premium_month` })).not.toBeInTheDocument();
  });

  it('adds a subscription price (interval required) after confirmation', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<PricesPage />, { 'GET /admin/billing/products': () => [premium], 'POST /admin/billing/products/premium/prices': (c) => ({ id: 'new', ...(c.body as object) }) });
    await user.click(await screen.findByRole('button', { name: t('billing.prices.newPrice') }));
    const d = screen.getByRole('dialog');
    await user.type(within(d).getByLabelText(t('billing.prices.providerPriceId'), { exact: false }), 'price_premium_year');
    await user.type(within(d).getByLabelText(t('billing.prices.currency'), { exact: false }), 'usd');
    await user.type(within(d).getByLabelText(t('billing.prices.amountMinor'), { exact: false }), '9999');
    expect(within(d).getByText(t('billing.prices.amountPreview', { amount: '$99.99' }))).toBeInTheDocument();
    await user.selectOptions(within(d).getByLabelText(t('billing.prices.interval'), { exact: false }), '');
    await user.type(within(d).getByLabelText(t('billing.prices.countries')), 'de, at');
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    expect(within(d).getByText(t('billing.prices.intervalRequired'))).toBeInTheDocument();
    await user.selectOptions(within(d).getByLabelText(t('billing.prices.interval'), { exact: false }), 'year');
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    await user.click(within(screen.getByRole('dialog', { name: t('billing.confirmLiveTitle') })).getByRole('button', { name: t('billing.confirmLiveAction') }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path.endsWith('/prices'))).toBe(true));
    expect(calls.find((c) => c.path === '/admin/billing/products/premium/prices')!.body).toEqual({
      provider: 'stripe', providerPriceId: 'price_premium_year', currency: 'USD', amountMinor: 9999, billingInterval: 'year', intervalCount: 1, trialDays: 0, quantity: 1, countryCodes: ['DE', 'AT'], isActive: true,
    });
  });

  it('edits a price keeping its provider identity', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<PricesPage />, { 'GET /admin/billing/products': () => [premium], 'POST /admin/billing/products/premium/prices': (c) => c.body });
    await user.click(await screen.findByRole('button', { name: `${t('common.edit')} com.amora.premium.3m` }));
    const d = screen.getByRole('dialog');
    expect(within(d).getByLabelText(t('billing.prices.providerPriceId'))).toHaveAttribute('readonly');
    const amount = within(d).getByLabelText(t('billing.prices.amountMinor'), { exact: false });
    expect(amount).toHaveValue(4999);
    await user.clear(amount);
    await user.type(amount, '3999');
    await user.click(within(d).getByLabelText(t('billing.prices.active')));
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    await user.click(within(screen.getByRole('dialog', { name: t('billing.confirmLiveTitle') })).getByRole('button', { name: t('billing.confirmLiveAction') }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path.endsWith('/prices'))).toBe(true));
    expect(calls.find((c) => c.path === '/admin/billing/products/premium/prices')!.body).toEqual({
      provider: 'apple', providerPriceId: 'com.amora.premium.3m', currency: 'EUR', amountMinor: 3999, billingInterval: 'month', intervalCount: 3, trialDays: 0, quantity: 1, countryCodes: ['DE', 'FR'], isActive: true,
    });
  });
});

