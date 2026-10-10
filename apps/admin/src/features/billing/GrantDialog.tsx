'use client';

import { adminGrant } from '@amora/shared';
import { useState } from 'react';
import { useNotify } from '@/components/shell/notice';
import { FormDialog } from '@/components/ui/FormDialog';
import { NumberField, ReadOnlyField, SelectField, TextField } from '@/components/ui/fields';
import { t } from '@/i18n';
import type { ConsumableItem } from '@/lib/api/modules/billing';
import { useAdminApi } from '@/lib/auth/session';
import { useFormSubmit } from '@/lib/forms/useFormSubmit';
import type { FieldErrors } from '@/lib/forms/validate';
import { entitlementOptions, itemOptions } from './labels';

type GrantType = 'entitlement' | 'consumable';

/** Grants exactly one of: an entitlement (optionally time-limited) or a consumable adjustment (may be negative). */
export function GrantDialog({ userId, onClose, onDone }: { userId: string; onClose: () => void; onDone: () => void }) {
  const api = useAdminApi();
  const notify = useNotify();
  const { busy, error, fieldErrors, submit } = useFormSubmit();
  const [type, setType] = useState<GrantType>('entitlement');
  const [entitlementKey, setEntitlementKey] = useState('');
  const [days, setDays] = useState<number | undefined>();
  const [itemKey, setItemKey] = useState<ConsumableItem | ''>('');
  const [quantity, setQuantity] = useState<number | undefined>();
  const [reasonKey, setReasonKey] = useState('');

  async function onSubmit() {
    const payload = type === 'entitlement'
      ? { userId, entitlementKey: entitlementKey || undefined, days, reasonKey: reasonKey.trim() }
      : { userId, consumable: { itemKey: itemKey || undefined, quantity }, reasonKey: reasonKey.trim() };
    // The contract's "exactly one of" refinement has no field path; report the missing field directly.
    const extra: FieldErrors = {};
    if (type === 'entitlement' && !entitlementKey) extra.entitlementKey = t('validation.required');
    if (type === 'consumable' && quantity === 0) extra['consumable.quantity'] = t('validation.invalid');
    const ok = await submit(adminGrant, payload, (data) => api.billing.grant(data), extra);
    if (ok) {
      notify(t('billing.grant.done'));
      onDone();
      onClose();
    }
  }

  return (
    <FormDialog title={t('billing.grant.title')} onClose={onClose} onSubmit={() => void onSubmit()} busy={busy} error={error} fieldErrors={fieldErrors} submitLabel={t('billing.grant.submit')}>
      <ReadOnlyField label={t('billing.users.userId')} value={userId} />
      <SelectField
        label={t('billing.grant.type')}
        value={type}
        onChange={(v) => setType(v as GrantType)}
        options={[{ value: 'entitlement', label: t('billing.grant.typeEntitlement') }, { value: 'consumable', label: t('billing.grant.typeConsumable') }]}
        required
      />
      {type === 'entitlement' ? (
        <div className="grid grid--2">
          <SelectField label={t('billing.grant.entitlement')} value={entitlementKey} onChange={setEntitlementKey} options={entitlementOptions()} placeholder={t('common.none')} error={fieldErrors.entitlementKey} required />
          <NumberField label={t('billing.grant.days')} hint={t('billing.grant.daysHint')} value={days} onChange={setDays} min={1} max={3650} step={1} error={fieldErrors.days} />
        </div>
      ) : (
        <div className="grid grid--2">
          <SelectField label={t('billing.grant.item')} value={itemKey} onChange={(v) => setItemKey(v as ConsumableItem | '')} options={itemOptions()} placeholder={t('common.none')} error={fieldErrors['consumable.itemKey']} required />
          <NumberField label={t('billing.grant.quantity')} hint={t('billing.grant.quantityHint')} value={quantity} onChange={setQuantity} min={-1000} max={1000} step={1} error={fieldErrors['consumable.quantity']} required />
        </div>
      )}
      <TextField label={t('billing.grant.reasonKey')} hint={t('billing.grant.reasonKeyHint')} value={reasonKey} onChange={setReasonKey} error={fieldErrors.reasonKey} required maxLength={60} spellCheck={false} autoComplete="off" />
    </FormDialog>
  );
}
