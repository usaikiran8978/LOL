'use client';

import { adminPriceUpsert } from '@amora/shared';
import { useState } from 'react';
import { FormDialog } from '@/components/ui/FormDialog';
import { CheckboxField, NumberField, ReadOnlyField, SelectField, TextField } from '@/components/ui/fields';
import { t } from '@/i18n';
import { toNumber, type BillingInterval, type BillingPriceRow, type BillingProductRow, type BillingProvider } from '@/lib/api/modules/billing';
import { useAdminApi } from '@/lib/auth/session';
import { formatMoney } from '@/lib/format';
import type { FieldErrors } from '@/lib/forms/validate';
import { countryList, intervalOptions, providerLabel, providerOptions } from './labels';
import { useLiveSave } from './useLiveSave';

interface PriceForm {
  provider: BillingProvider;
  providerPriceId: string;
  currency: string;
  amountMinor: number | undefined;
  billingInterval: BillingInterval | '';
  intervalCount: number | undefined;
  trialDays: number | undefined;
  quantity: number | undefined;
  countries: string;
  isActive: boolean;
}

function toForm(p: BillingPriceRow | null, product: BillingProductRow): PriceForm {
  if (!p) {
    return {
      provider: 'stripe', providerPriceId: '', currency: '', amountMinor: undefined, billingInterval: product.kind === 'subscription' ? 'month' : '',
      intervalCount: 1, trialDays: 0, quantity: 1, countries: '', isActive: true,
    };
  }
  return {
    provider: p.provider,
    providerPriceId: p.provider_price_id,
    currency: p.currency.trim(),
    amountMinor: toNumber(p.amount_minor) ?? undefined,
    billingInterval: p.billing_interval ?? '',
    intervalCount: p.interval_count ?? 1,
    trialDays: p.trial_days,
    quantity: p.quantity,
    countries: (p.country_codes ?? []).map((c) => c.trim()).join(', '),
    isActive: p.is_active,
  };
}

/** Prices are upserted by (provider, provider price ID); both are fixed once the price exists. */
export function PriceDialog({ product, price, onClose, onSaved }: { product: BillingProductRow; price: BillingPriceRow | null; onClose: () => void; onSaved: () => void }) {
  const api = useAdminApi();
  const save = useLiveSave(() => {
    onSaved();
    onClose();
  });
  const [form, setForm] = useState<PriceForm>(() => toForm(price, product));
  const set = <K extends keyof PriceForm>(k: K) => (v: PriceForm[K]) => setForm((s) => ({ ...s, [k]: v }));
  const errors = save.fieldErrors;
  const currency = form.currency.trim().toUpperCase();
  const preview = form.amountMinor !== undefined && /^[A-Z]{3}$/.test(currency) ? formatMoney(form.amountMinor, currency) : null;

  function submit() {
    const payload = {
      provider: form.provider,
      providerPriceId: form.providerPriceId.trim(),
      currency,
      amountMinor: form.amountMinor,
      billingInterval: form.billingInterval || null,
      intervalCount: form.intervalCount,
      trialDays: form.trialDays,
      quantity: form.quantity,
      countryCodes: countryList(form.countries),
      isActive: form.isActive,
    };
    // The API requires an interval for subscription prices (checked server-side, not in the shared schema).
    const extra: FieldErrors = product.kind === 'subscription' && !form.billingInterval ? { billingInterval: t('billing.prices.intervalRequired') } : {};
    save.review(adminPriceUpsert, payload, (data) => api.billing.upsertPrice(product.key, data), extra);
  }

  return (
    <>
      <FormDialog
        title={price ? t('billing.prices.editPrice', { id: price.provider_price_id }) : t('billing.prices.newPrice')}
        onClose={onClose}
        onSubmit={submit}
        busy={save.busy}
        error={save.error}
        fieldErrors={errors}
        size="lg"
      >
        <ReadOnlyField label={t('billing.prices.product')} value={product.key} />
        {price ? (
          <div className="grid grid--2">
            <ReadOnlyField label={t('billing.prices.provider')} value={providerLabel(price.provider)} hint={t('billing.prices.identityHint')} />
            <ReadOnlyField label={t('billing.prices.providerPriceId')} value={price.provider_price_id} />
          </div>
        ) : (
          <div className="grid grid--2">
            <SelectField label={t('billing.prices.provider')} value={form.provider} onChange={(v) => set('provider')(v as BillingProvider)} options={providerOptions()} error={errors.provider} required />
            <TextField label={t('billing.prices.providerPriceId')} hint={t('billing.prices.providerPriceIdHint')} value={form.providerPriceId} onChange={set('providerPriceId')} error={errors.providerPriceId} required spellCheck={false} maxLength={200} data-autofocus />
          </div>
        )}
        <div className="grid grid--2">
          <TextField label={t('billing.prices.currency')} hint={t('billing.prices.currencyHint')} value={form.currency} onChange={set('currency')} error={errors.currency} required maxLength={3} spellCheck={false} autoComplete="off" />
          <NumberField
            label={t('billing.prices.amountMinor')}
            hint={preview ? t('billing.prices.amountPreview', { amount: preview }) : undefined}
            value={form.amountMinor}
            onChange={set('amountMinor')}
            min={0}
            step={1}
            error={errors.amountMinor}
            required
          />
        </div>
        <div className="grid grid--3">
          <SelectField label={t('billing.prices.interval')} value={form.billingInterval} onChange={(v) => set('billingInterval')(v as BillingInterval | '')} options={intervalOptions()} placeholder={t('billing.prices.noInterval')} error={errors.billingInterval} required={product.kind === 'subscription'} />
          <NumberField label={t('billing.prices.intervalCount')} value={form.intervalCount} onChange={set('intervalCount')} min={1} max={12} step={1} error={errors.intervalCount} />
          <NumberField label={t('billing.prices.trialDays')} value={form.trialDays} onChange={set('trialDays')} min={0} max={90} step={1} error={errors.trialDays} />
        </div>
        <div className="grid grid--2">
          <NumberField label={t('billing.prices.quantity')} hint={t('billing.prices.quantityHint')} value={form.quantity} onChange={set('quantity')} min={1} step={1} error={errors.quantity} />
          <TextField label={t('billing.prices.countries')} hint={t('billing.prices.countriesHint')} value={form.countries} onChange={set('countries')} error={errors.countryCodes ?? Object.entries(errors).find(([k]) => k.startsWith('countryCodes.'))?.[1]} spellCheck={false} />
        </div>
        <CheckboxField label={t('billing.prices.active')} checked={form.isActive} onChange={set('isActive')} />
      </FormDialog>
      {save.confirmDialog}
    </>
  );
}
