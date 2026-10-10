import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { t } from '@/i18n';
import { apiError, renderSignedIn } from '@/test/utils';
import { CouponsPage } from './CouponsPage';
import { FreeTierPage } from './FreeTierPage';

const likes = { entitlement_key: 'likes', limit_value: 25, limit_period: 'day', country_overrides: { DE: 50, FR: null } };
const ai = { entitlement_key: 'ai_requests', limit_value: null, limit_period: null, country_overrides: '{}' };

const confirmLive = async (user: ReturnType<typeof userEvent.setup>) =>
  user.click(within(screen.getByRole('dialog', { name: t('billing.confirmLiveTitle') })).getByRole('button', { name: t('billing.confirmLiveAction') }));

describe('FreeTierPage', () => {
  it('lists limits with overrides', async () => {
    await renderSignedIn(<FreeTierPage />, { 'GET /admin/billing/free-tier': () => [ai, likes] });
    expect(await screen.findByText(`DE: 50, FR: ${t('billing.unlimited')}`)).toBeInTheDocument();
    expect(screen.getByText('25')).toBeInTheDocument();
    expect(screen.getAllByText(t('billing.unlimited')).length).toBeGreaterThan(0);
  });

  it('shows empty and error states', async () => {
    const user = userEvent.setup();
    let n = 0;
    await renderSignedIn(<FreeTierPage />, { 'GET /admin/billing/free-tier': () => (n++ === 0 ? apiError(503, 'INTERNAL') : []) });
    expect(await screen.findByRole('button', { name: t('common.retry') })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('common.retry') }));
    expect(await screen.findByText(t('billing.freeTier.empty'))).toBeInTheDocument();
  });

  it('hides editing without billing.plans.manage', async () => {
    await renderSignedIn(<FreeTierPage />, { 'GET /admin/billing/free-tier': () => [likes] }, ['billing.view']);
    expect(await screen.findByText('25')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: `${t('common.edit')} likes` })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('billing.freeTier.newLimit') })).not.toBeInTheDocument();
  });

  it('edits a limit and its country overrides after confirmation', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<FreeTierPage />, { 'GET /admin/billing/free-tier': () => [likes], 'PUT /admin/billing/free-tier/likes': (c) => c.body });
    await user.click(await screen.findByRole('button', { name: `${t('common.edit')} likes` }));
    const d = screen.getByRole('dialog');
    const limit = within(d).getByLabelText(t('billing.freeTier.limit'));
    expect(limit).toHaveValue(25);
    await user.clear(limit);
    await user.type(limit, '30');
    await user.click(within(d).getByRole('button', { name: t('billing.freeTier.removeOverride', { n: 2 }) }));
    await user.click(within(d).getByRole('button', { name: t('billing.freeTier.addOverride') }));
    const countries = within(d).getAllByRole('textbox', { name: new RegExp(`^${t('billing.freeTier.overrideCountry')}( \\*)?$`) });
    await user.type(countries[1]!, 'de');
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    expect(within(d).getByText(t('billing.freeTier.duplicateCountry'))).toBeInTheDocument();
    await user.clear(countries[1]!);
    await user.type(countries[1]!, 'us');
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    await confirmLive(user);
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ limitValue: 30, limitPeriod: 'day', countryOverrides: { DE: 50, US: null } });
  });

  it('adds a limit for an unconfigured entitlement', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<FreeTierPage />, { 'GET /admin/billing/free-tier': () => [likes], 'PUT /admin/billing/free-tier/rewinds': (c) => c.body });
    await user.click(await screen.findByRole('button', { name: t('billing.freeTier.newLimit') }));
    const d = screen.getByRole('dialog');
    const select = within(d).getByLabelText(t('billing.freeTier.entitlement'), { exact: false });
    expect(within(select).queryByRole('option', { name: t('billing.entitlementKeys.likes') })).not.toBeInTheDocument();
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    expect(within(d).getByText(t('validation.required'))).toBeInTheDocument();
    await user.selectOptions(select, 'rewinds');
    await user.type(within(d).getByLabelText(t('billing.freeTier.limit')), '1');
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    await confirmLive(user);
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ limitValue: 1, limitPeriod: 'day', countryOverrides: {} });
  });
});

const spring = {
  id: 'c1', code: 'SPRING20', description: 'Spring sale', discount_type: 'percent', percent_off: 20, amount_off_minor: null, currency: null, trial_days: null, grant_entitlement_key: null, grant_days: null,
  country_codes: ['DE', 'FR'], per_user_limit: 2, provider_coupon_id: 'promo_123', product_keys: ['premium'], is_active: true, valid_from: '2026-03-01T00:00:00Z', valid_until: '2026-04-01T00:00:00Z',
  max_redemptions: 100, redemptions: '12',
};
const products = [{ id: 'p1', key: 'premium', kind: 'subscription', tier: 'premium', rank: 1, is_active: true, consumable_item_key: null, consumable_quantity: null, created_at: '', updated_at: '', prices: [], entitlements: [], translations: { en: { name: 'Premium', description: null } } }];

describe('CouponsPage', () => {
  it('lists coupons with redemptions', async () => {
    await renderSignedIn(<CouponsPage />, { 'GET /admin/billing/coupons': () => [spring], 'GET /admin/billing/products': () => products });
    expect(await screen.findByText('SPRING20')).toBeInTheDocument();
    expect(screen.getByText(t('billing.coupons.redemptionsOf', { count: '12', max: '100' }))).toBeInTheDocument();
    expect(screen.getByText(t('billing.coupons.types.percent'))).toBeInTheDocument();
  });

  it('shows empty and error states', async () => {
    const user = userEvent.setup();
    let n = 0;
    await renderSignedIn(<CouponsPage />, { 'GET /admin/billing/coupons': () => (n++ === 0 ? apiError(500, 'INTERNAL') : []), 'GET /admin/billing/products': () => products });
    await user.click(await screen.findByRole('button', { name: t('common.retry') }));
    expect(await screen.findByText(t('billing.coupons.empty'))).toBeInTheDocument();
  });

  it('is forbidden without billing.coupons.manage', async () => {
    const { calls } = await renderSignedIn(<CouponsPage />, {}, ['billing.view']);
    expect(screen.getByText(t('states.forbiddenTitle'))).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/admin/billing/coupons')).toBe(false);
  });

  it('creates a percent coupon restricted to a product after confirmation', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<CouponsPage />, {
      'GET /admin/billing/coupons': () => [], 'GET /admin/billing/products': () => products, 'PUT /admin/billing/coupons/SUMMER25': (c) => c.body,
    });
    await user.click(await screen.findByRole('button', { name: t('billing.coupons.newCoupon') }));
    const d = screen.getByRole('dialog');
    await user.type(within(d).getByLabelText(t('billing.coupons.code'), { exact: false }), 'SUMMER25');
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    expect(within(d).getByText(t('validation.required'))).toBeInTheDocument();
    await user.type(within(d).getByLabelText(t('billing.coupons.percentOff'), { exact: false }), '25');
    await user.click(within(d).getByLabelText('premium'));
    await user.type(within(d).getByLabelText(t('billing.coupons.maxRedemptions')), '500');
    fireEvent.change(within(d).getByLabelText(t('billing.coupons.validUntil')), { target: { value: '2026-09-01T00:00' } });
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    await confirmLive(user);
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({
      code: 'SUMMER25', discountType: 'percent', percentOff: 25, amountOffMinor: null, currency: null, trialDays: null, grantEntitlementKey: null, grantDays: null,
      productKeys: ['premium'], countryCodes: null, maxRedemptions: 500, perUserLimit: 1, validUntil: new Date('2026-09-01T00:00').toISOString(), providerCouponId: null, isActive: true,
    });
  });

  it('requires amount and currency for amount coupons', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<CouponsPage />, {
      'GET /admin/billing/coupons': () => [], 'GET /admin/billing/products': () => products, 'PUT /admin/billing/coupons/TENOFF': (c) => c.body,
    });
    await user.click(await screen.findByRole('button', { name: t('billing.coupons.newCoupon') }));
    const d = screen.getByRole('dialog');
    await user.type(within(d).getByLabelText(t('billing.coupons.code'), { exact: false }), 'TENOFF');
    await user.selectOptions(within(d).getByLabelText(t('billing.coupons.discountType'), { exact: false }), 'amount');
    await user.type(within(d).getByLabelText(t('billing.coupons.amountOffMinor'), { exact: false }), '1000');
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    expect(within(d).getByText(t('validation.required'))).toBeInTheDocument();
    await user.type(within(d).getByLabelText(t('billing.coupons.currency'), { exact: false }), 'eur');
    expect(within(d).getByText(t('billing.prices.amountPreview', { amount: '€10.00' }))).toBeInTheDocument();
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    await confirmLive(user);
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')!.body).toMatchObject({ discountType: 'amount', amountOffMinor: 1000, currency: 'EUR', percentOff: null, productKeys: null });
  });

  it('prefills every stored field on edit and saves them back unchanged', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<CouponsPage />, {
      'GET /admin/billing/coupons': () => [spring], 'GET /admin/billing/products': () => products, 'PUT /admin/billing/coupons/SPRING20': (c) => c.body,
    });
    await user.click(await screen.findByRole('button', { name: `${t('common.edit')} SPRING20` }));
    const d = screen.getByRole('dialog', { name: t('billing.coupons.editCoupon', { code: 'SPRING20' }) });
    expect(within(d).getByLabelText(t('billing.coupons.code'))).toHaveAttribute('readonly');
    expect(within(d).getByLabelText(t('billing.coupons.maxRedemptions'))).toHaveValue(100);
    expect(within(d).getByLabelText(t('billing.coupons.percentOff'), { exact: false })).toHaveValue(20);
    expect(within(d).getByLabelText(t('billing.coupons.perUserLimit'), { exact: false })).toHaveValue(2);
    expect(within(d).getByLabelText(t('billing.coupons.countries'))).toHaveValue('DE, FR');
    expect(within(d).getByLabelText(t('billing.coupons.providerCouponId'))).toHaveValue('promo_123');
    expect(within(d).getByRole('checkbox', { name: 'premium' })).toBeChecked();
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    await confirmLive(user);
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')!.body).toMatchObject({
      code: 'SPRING20', discountType: 'percent', percentOff: 20, productKeys: ['premium'], countryCodes: ['DE', 'FR'], perUserLimit: 2, providerCouponId: 'promo_123', maxRedemptions: 100,
    });
  }, 15_000);

  it('does not load the catalogue without billing.view and takes product keys as text', async () => {
    const user = userEvent.setup();
    const { calls } = await renderSignedIn(<CouponsPage />, { 'GET /admin/billing/coupons': () => [], 'PUT /admin/billing/coupons/TRIAL': (c) => c.body }, ['billing.coupons.manage']);
    await user.click(await screen.findByRole('button', { name: t('billing.coupons.newCoupon') }));
    expect(calls.some((c) => c.path === '/admin/billing/products')).toBe(false);
    const d = screen.getByRole('dialog');
    await user.type(within(d).getByLabelText(t('billing.coupons.code'), { exact: false }), 'TRIAL');
    await user.selectOptions(within(d).getByLabelText(t('billing.coupons.discountType'), { exact: false }), 'free_trial_days');
    await user.type(within(d).getByLabelText(t('billing.coupons.trialDays'), { exact: false }), '14');
    await user.type(within(d).getByLabelText(t('billing.coupons.productKeys')), 'premium, ai_premium');
    await user.click(within(d).getByRole('button', { name: t('common.save') }));
    await confirmLive(user);
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')!.body).toMatchObject({ discountType: 'free_trial_days', trialDays: 14, productKeys: ['premium', 'ai_premium'] });
  });
});
