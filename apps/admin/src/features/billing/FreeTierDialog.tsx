'use client';

import { adminFreeTierLimit, countryCode } from '@amora/shared';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { FormDialog } from '@/components/ui/FormDialog';
import { NumberField, ReadOnlyField, SelectField, TextField } from '@/components/ui/fields';
import { t } from '@/i18n';
import type { FreeTierRow, LimitPeriod } from '@/lib/api/modules/billing';
import { useAdminApi } from '@/lib/auth/session';
import type { FieldErrors } from '@/lib/forms/validate';
import { entitlementLabel, entitlementOptions, overridesOf, periodOptions, rowId } from './labels';
import { useLiveSave } from './useLiveSave';

interface OverrideDraft {
  id: string;
  country: string;
  limit: number | undefined;
}

interface FreeTierForm {
  key: string;
  limit: number | undefined;
  period: LimitPeriod | '';
  overrides: OverrideDraft[];
}

function toForm(row: FreeTierRow | null): FreeTierForm {
  if (!row) return { key: '', limit: undefined, period: 'day', overrides: [] };
  return {
    key: row.entitlement_key,
    limit: row.limit_value ?? undefined,
    period: row.limit_period ?? '',
    overrides: Object.entries(overridesOf(row.country_overrides)).map(([country, limit]) => ({ id: rowId(), country, limit: limit ?? undefined })),
  };
}

/** Country codes are validated per row (the contract reports bad record keys without a usable row index). */
function overrideErrors(rows: OverrideDraft[]): FieldErrors {
  const errors: FieldErrors = {};
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    const code = r.country.trim().toUpperCase();
    if (!code) errors[`overrides.${i}.country`] = t('validation.required');
    else if (!countryCode.safeParse(code).success) errors[`overrides.${i}.country`] = t('validation.invalidFormat');
    else if (seen.has(code)) errors[`overrides.${i}.country`] = t('billing.freeTier.duplicateCountry');
    else if (r.limit !== undefined && (!Number.isInteger(r.limit) || r.limit < 0)) errors[`overrides.${i}.limit`] = t('validation.tooSmall', { min: 0 });
    seen.add(code);
  });
  return errors;
}

export function FreeTierDialog({ row, availableKeys, onClose, onSaved }: { row: FreeTierRow | null; availableKeys: string[]; onClose: () => void; onSaved: () => void }) {
  const api = useAdminApi();
  const save = useLiveSave(() => {
    onSaved();
    onClose();
  });
  const [form, setForm] = useState<FreeTierForm>(() => toForm(row));
  const set = <K extends keyof FreeTierForm>(k: K) => (v: FreeTierForm[K]) => setForm((s) => ({ ...s, [k]: v }));
  const errors = save.fieldErrors;
  const updateOverride = (i: number, patch: Partial<OverrideDraft>) => set('overrides')(form.overrides.map((o, j) => (j === i ? { ...o, ...patch } : o)));

  function submit() {
    const payload = {
      limitValue: form.limit ?? null,
      limitPeriod: form.period || null,
      countryOverrides: Object.fromEntries(form.overrides.map((o) => [o.country.trim().toUpperCase(), o.limit ?? null])),
    };
    const extra: FieldErrors = { ...overrideErrors(form.overrides) };
    if (!form.key) extra.key = t('validation.required');
    save.review(adminFreeTierLimit, payload, (data) => api.billing.setFreeTier(form.key, data), extra);
  }

  return (
    <>
      <FormDialog
        title={row ? t('billing.freeTier.editLimit', { key: entitlementLabel(row.entitlement_key) }) : t('billing.freeTier.newLimit')}
        onClose={onClose}
        onSubmit={submit}
        busy={save.busy}
        error={save.error}
        fieldErrors={errors}
      >
        {row ? (
          <ReadOnlyField label={t('billing.freeTier.entitlement')} value={`${entitlementLabel(row.entitlement_key)} (${row.entitlement_key})`} />
        ) : (
          <SelectField label={t('billing.freeTier.entitlement')} value={form.key} onChange={set('key')} options={entitlementOptions(availableKeys)} placeholder={t('common.none')} error={errors.key} required />
        )}
        <div className="grid grid--2">
          <NumberField label={t('billing.freeTier.limit')} hint={t('billing.freeTier.limitHint')} value={form.limit} onChange={set('limit')} min={0} step={1} error={errors.limitValue} />
          <SelectField label={t('billing.freeTier.period')} value={form.period} onChange={(v) => set('period')(v as LimitPeriod | '')} options={periodOptions()} placeholder={t('billing.noPeriod')} error={errors.limitPeriod} />
        </div>
        <fieldset className="rules">
          <legend>{t('billing.freeTier.overrides')}</legend>
          {errors.countryOverrides ? <p className="field__error" role="alert">{errors.countryOverrides}</p> : null}
          {form.overrides.length === 0 ? <p className="muted">{t('billing.freeTier.noOverrides')}</p> : null}
          <ol className="rules__list">
            {form.overrides.map((o, i) => (
              <li key={o.id} className="rule" aria-label={t('billing.freeTier.overrideEntry', { n: i + 1 })}>
                <div className="grid grid--2">
                  <TextField label={t('billing.freeTier.overrideCountry')} value={o.country} onChange={(country) => updateOverride(i, { country })} error={errors[`overrides.${i}.country`]} maxLength={2} required spellCheck={false} autoComplete="off" />
                  <NumberField label={t('billing.freeTier.overrideLimit')} hint={t('billing.freeTier.limitHint')} value={o.limit} onChange={(limit) => updateOverride(i, { limit })} min={0} step={1} error={errors[`overrides.${i}.limit`]} />
                </div>
                <Button variant="ghost" size="sm" onClick={() => set('overrides')(form.overrides.filter((_, j) => j !== i))} aria-label={t('billing.freeTier.removeOverride', { n: i + 1 })}>
                  {t('common.remove')}
                </Button>
              </li>
            ))}
          </ol>
          <Button variant="secondary" size="sm" onClick={() => set('overrides')([...form.overrides, { id: rowId(), country: '', limit: undefined }])}>{t('billing.freeTier.addOverride')}</Button>
        </fieldset>
      </FormDialog>
      {save.confirmDialog}
    </>
  );
}
