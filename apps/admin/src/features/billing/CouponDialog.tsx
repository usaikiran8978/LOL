'use client';

import { adminCouponUpsert } from '@amora/shared';
import { useState } from 'react';
import { FormDialog } from '@/components/ui/FormDialog';
import { CheckboxField, NumberField, ReadOnlyField, SelectField, TextAreaField, TextField } from '@/components/ui/fields';
import { t } from '@/i18n';
import { toNumber, type CouponRow, type DiscountType } from '@/lib/api/modules/billing';
import { useAdminApi } from '@/lib/auth/session';
import { formatMoney } from '@/lib/format';
import { isoToLocalInput, localInputToIso, parseList, type FieldErrors } from '@/lib/forms/validate';
import { countryList, discountOptions, entitlementOptions } from './labels';
import { useLiveSave } from './useLiveSave';

interface CouponForm {
  code: string;
  description: string;
  discountType: DiscountType;
  percentOff: number | undefined;
  amountOffMinor: number | undefined;
  currency: string;
  trialDays: number | undefined;
  grantEntitlementKey: string;
  grantDays: number | undefined;
  productKeys: string[];
  productKeysText: string;
  countries: string;
  maxRedemptions: number | undefined;
  perUserLimit: number | undefined;
  validFrom: string;
  validUntil: string;
  providerCouponId: string;
  isActive: boolean;
}

/** The list endpoint returns every editable field, so an edit starts from the stored values. */
function toForm(c: CouponRow | null): CouponForm {
  const products = c?.product_keys ?? [];
  const num = (v: number | string | null | undefined) => toNumber(v) ?? undefined;
  return {
    code: c?.code ?? '',
    description: c?.description ?? '',
    discountType: c?.discount_type ?? 'percent',
    percentOff: num(c?.percent_off),
    amountOffMinor: num(c?.amount_off_minor),
    currency: c?.currency ?? '',
    trialDays: num(c?.trial_days),
    grantEntitlementKey: c?.grant_entitlement_key ?? '',
    grantDays: num(c?.grant_days),
    productKeys: products,
    productKeysText: products.join(', '),
    countries: (c?.country_codes ?? []).join(', '),
    maxRedemptions: c?.max_redemptions ?? undefined,
    perUserLimit: c?.per_user_limit ?? 1,
    validFrom: isoToLocalInput(c?.valid_from),
    validUntil: isoToLocalInput(c?.valid_until),
    providerCouponId: c?.provider_coupon_id ?? '',
    isActive: c?.is_active ?? true,
  };
}

/** The shared schema only says "fields for the chosen discountType are missing"; point at the actual fields. */
function discountErrors(f: CouponForm): FieldErrors {
  const req = t('validation.required');
  const e: FieldErrors = {};
  if (f.discountType === 'percent' && f.percentOff === undefined) e.percentOff = req;
  if (f.discountType === 'amount') {
    if (f.amountOffMinor === undefined) e.amountOffMinor = req;
    if (!f.currency.trim()) e.currency = req;
  }
  if (f.discountType === 'free_trial_days' && f.trialDays === undefined) e.trialDays = req;
  if (f.discountType === 'grant_entitlement') {
    if (!f.grantEntitlementKey) e.grantEntitlementKey = req;
    if (f.grantDays === undefined) e.grantDays = req;
  }
  if (f.validFrom && !localInputToIso(f.validFrom)) e.validFrom = t('validation.invalidDate');
  if (f.validUntil && !localInputToIso(f.validUntil)) e.validUntil = t('validation.invalidDate');
  return e;
}

/** `productKeys` is offered as a checklist when the admin can read the catalogue (billing.view), else free text. */
export function CouponDialog({ coupon, productKeys, onClose, onSaved }: { coupon: CouponRow | null; productKeys: string[] | null; onClose: () => void; onSaved: () => void }) {
  const api = useAdminApi();
  const save = useLiveSave(() => {
    onSaved();
    onClose();
  });
  const [form, setForm] = useState<CouponForm>(() => toForm(coupon));
  const set = <K extends keyof CouponForm>(k: K) => (v: CouponForm[K]) => setForm((s) => ({ ...s, [k]: v }));
  const errors = save.fieldErrors;
  const type = form.discountType;
  const currency = form.currency.trim().toUpperCase();
  const amountPreview = form.amountOffMinor !== undefined && /^[A-Z]{3}$/.test(currency) ? formatMoney(form.amountOffMinor, currency) : null;

  function toggleProduct(key: string, on: boolean) {
    set('productKeys')(on ? [...form.productKeys, key] : form.productKeys.filter((k) => k !== key));
  }

  function submit() {
    const products = productKeys ? form.productKeys : parseList(form.productKeysText);
    const payload = {
      code: form.code.trim(),
      description: form.description.trim() || undefined,
      discountType: type,
      percentOff: type === 'percent' ? (form.percentOff ?? null) : null,
      amountOffMinor: type === 'amount' ? (form.amountOffMinor ?? null) : null,
      currency: type === 'amount' ? currency || null : null,
      trialDays: type === 'free_trial_days' ? (form.trialDays ?? null) : null,
      grantEntitlementKey: type === 'grant_entitlement' ? form.grantEntitlementKey || null : null,
      grantDays: type === 'grant_entitlement' ? (form.grantDays ?? null) : null,
      productKeys: products.length ? products : null,
      countryCodes: countryList(form.countries),
      maxRedemptions: form.maxRedemptions ?? null,
      perUserLimit: form.perUserLimit,
      validFrom: localInputToIso(form.validFrom) ?? undefined,
      validUntil: localInputToIso(form.validUntil),
      providerCouponId: form.providerCouponId.trim() || null,
      isActive: form.isActive,
    };
    save.review(adminCouponUpsert, payload, (data) => api.billing.upsertCoupon(data), discountErrors(form));
  }

  return (
    <>
      <FormDialog
        title={coupon ? t('billing.coupons.editCoupon', { code: coupon.code }) : t('billing.coupons.newCoupon')}
        onClose={onClose}
        onSubmit={submit}
        busy={save.busy}
        error={save.error}
        fieldErrors={errors}
        size="lg"
      >
        <div className="grid grid--2">
          {coupon ? (
            <ReadOnlyField label={t('billing.coupons.code')} value={coupon.code} hint={t('common.immutableHint')} />
          ) : (
            <TextField label={t('billing.coupons.code')} hint={t('billing.coupons.codeHint')} value={form.code} onChange={set('code')} error={errors.code} required maxLength={50} spellCheck={false} autoComplete="off" data-autofocus />
          )}
          <SelectField label={t('billing.coupons.discountType')} value={type} onChange={(v) => set('discountType')(v as DiscountType)} options={discountOptions()} error={errors.discountType} required />
        </div>
        <TextAreaField label={t('common.description')} value={form.description} onChange={set('description')} error={errors.description} rows={2} maxLength={300} />
        {type === 'percent' ? (
          <NumberField label={t('billing.coupons.percentOff')} value={form.percentOff} onChange={set('percentOff')} min={1} max={100} step={1} error={errors.percentOff} required />
        ) : null}
        {type === 'amount' ? (
          <div className="grid grid--2">
            <NumberField
              label={t('billing.coupons.amountOffMinor')}
              hint={amountPreview ? t('billing.prices.amountPreview', { amount: amountPreview }) : undefined}
              value={form.amountOffMinor}
              onChange={set('amountOffMinor')}
              min={1}
              step={1}
              error={errors.amountOffMinor}
              required
            />
            <TextField label={t('billing.coupons.currency')} hint={t('billing.prices.currencyHint')} value={form.currency} onChange={set('currency')} error={errors.currency} required maxLength={3} spellCheck={false} autoComplete="off" />
          </div>
        ) : null}
        {type === 'free_trial_days' ? (
          <NumberField label={t('billing.coupons.trialDays')} value={form.trialDays} onChange={set('trialDays')} min={1} max={90} step={1} error={errors.trialDays} required />
        ) : null}
        {type === 'grant_entitlement' ? (
          <div className="grid grid--2">
            <SelectField label={t('billing.coupons.grantEntitlementKey')} value={form.grantEntitlementKey} onChange={set('grantEntitlementKey')} options={entitlementOptions()} placeholder={t('common.none')} error={errors.grantEntitlementKey} required />
            <NumberField label={t('billing.coupons.grantDays')} value={form.grantDays} onChange={set('grantDays')} min={1} max={365} step={1} error={errors.grantDays} required />
          </div>
        ) : null}
        <div className="grid grid--2">
          <TextField type="datetime-local" label={t('billing.coupons.validFrom')} hint={t('billing.coupons.validFromHint')} value={form.validFrom} onChange={set('validFrom')} error={errors.validFrom} />
          <TextField type="datetime-local" label={t('billing.coupons.validUntil')} hint={t('billing.coupons.validUntilHint')} value={form.validUntil} onChange={set('validUntil')} error={errors.validUntil} />
        </div>
        <div className="grid grid--2">
          <NumberField label={t('billing.coupons.maxRedemptions')} hint={t('billing.coupons.maxRedemptionsHint')} value={form.maxRedemptions} onChange={set('maxRedemptions')} min={1} step={1} error={errors.maxRedemptions} />
          <NumberField label={t('billing.coupons.perUserLimit')} value={form.perUserLimit} onChange={set('perUserLimit')} min={1} step={1} error={errors.perUserLimit} required />
        </div>
        {productKeys ? (
          <fieldset className="checkbox-group">
            <legend>{t('billing.coupons.productKeys')}</legend>
            <p className="field__hint">{t('billing.coupons.productKeysHint')}</p>
            {productKeys.map((k) => (
              <CheckboxField key={k} label={k} checked={form.productKeys.includes(k)} onChange={(on) => toggleProduct(k, on)} />
            ))}
          </fieldset>
        ) : (
          <TextField label={t('billing.coupons.productKeys')} hint={t('billing.coupons.productKeysHint')} value={form.productKeysText} onChange={set('productKeysText')} error={errors.productKeys} spellCheck={false} />
        )}
        <TextField label={t('billing.coupons.countries')} hint={t('billing.coupons.countriesHint')} value={form.countries} onChange={set('countries')} error={errors.countryCodes ?? Object.entries(errors).find(([k]) => k.startsWith('countryCodes.'))?.[1]} spellCheck={false} />
        <TextField label={t('billing.coupons.providerCouponId')} hint={t('billing.coupons.providerCouponIdHint')} value={form.providerCouponId} onChange={set('providerCouponId')} error={errors.providerCouponId} maxLength={200} spellCheck={false} />
        <CheckboxField label={t('billing.coupons.active')} checked={form.isActive} onChange={set('isActive')} />
      </FormDialog>
      {save.confirmDialog}
    </>
  );
}
