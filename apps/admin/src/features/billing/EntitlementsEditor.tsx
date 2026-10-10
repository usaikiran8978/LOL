'use client';

import { Button } from '@/components/ui/Button';
import { NumberField, SelectField } from '@/components/ui/fields';
import { t } from '@/i18n';
import type { LimitPeriod } from '@/lib/api/modules/billing';
import type { FieldErrors } from '@/lib/forms/validate';
import { entitlementOptions, periodOptions, rowId } from './labels';

export interface EntitlementDraft {
  id: string;
  key: string;
  limit: number | undefined;
  period: LimitPeriod | '';
}

export const newEntitlement = (): EntitlementDraft => ({ id: rowId(), key: '', limit: undefined, period: '' });

/** Rows → contract entries (empty limit = unlimited, empty period = none). */
export const entitlementsPayload = (rows: EntitlementDraft[]) =>
  rows.map((r) => ({ key: r.key, limit: r.limit ?? null, period: r.period || null }));

/** Duplicate keys would violate the (product, entitlement) primary key; reported on the later row. */
export function duplicateEntitlementErrors(rows: EntitlementDraft[]): FieldErrors {
  const seen = new Set<string>();
  const errors: FieldErrors = {};
  rows.forEach((r, i) => {
    if (!r.key) return;
    if (seen.has(r.key)) errors[`entitlements.${i}.key`] = t('validation.duplicate', { value: r.key });
    seen.add(r.key);
  });
  return errors;
}

/** Edits what a plan grants. `errors` use the contract paths (`entitlements.<i>.<field>`). */
export function EntitlementsEditor({ rows, onChange, errors }: { rows: EntitlementDraft[]; onChange: (rows: EntitlementDraft[]) => void; errors: FieldErrors }) {
  const update = (i: number, patch: Partial<EntitlementDraft>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <fieldset className="rules">
      <legend>{t('billing.entitlementEditor.legend')}</legend>
      {errors.entitlements ? <p className="field__error" role="alert">{errors.entitlements}</p> : null}
      {rows.length === 0 ? <p className="muted">{t('billing.entitlementEditor.empty')}</p> : null}
      <ol className="rules__list">
        {rows.map((r, i) => (
          <li key={r.id} className="rule" aria-label={t('billing.entitlementEditor.entry', { n: i + 1 })}>
            <div className="grid grid--3">
              <SelectField
                label={t('billing.entitlementEditor.key')}
                value={r.key}
                onChange={(key) => update(i, { key })}
                options={entitlementOptions()}
                placeholder={t('common.none')}
                error={errors[`entitlements.${i}.key`]}
                required
              />
              <NumberField
                label={t('billing.entitlementEditor.limit')}
                hint={t('billing.entitlementEditor.limitHint')}
                value={r.limit}
                onChange={(limit) => update(i, { limit })}
                min={0}
                step={1}
                error={errors[`entitlements.${i}.limit`]}
              />
              <SelectField
                label={t('billing.entitlementEditor.period')}
                value={r.period}
                onChange={(period) => update(i, { period: period as LimitPeriod | '' })}
                options={periodOptions()}
                placeholder={t('billing.noPeriod')}
                error={errors[`entitlements.${i}.period`]}
              />
            </div>
            <Button variant="ghost" size="sm" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label={t('billing.entitlementEditor.remove', { n: i + 1 })}>
              {t('common.remove')}
            </Button>
          </li>
        ))}
      </ol>
      <Button variant="secondary" size="sm" onClick={() => onChange([...rows, newEntitlement()])}>{t('billing.entitlementEditor.add')}</Button>
    </fieldset>
  );
}
