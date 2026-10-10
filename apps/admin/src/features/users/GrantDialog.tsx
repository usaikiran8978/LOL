'use client';

import { adminGrant, ENTITLEMENT_KEYS } from '@amora/shared';
import { useState } from 'react';
import { useNotify } from '@/components/shell/notice';
import { FormDialog } from '@/components/ui/FormDialog';
import { NumberField, SelectField, TextField } from '@/components/ui/fields';
import { t, tDynamic } from '@/i18n';
import { useAdminApi } from '@/lib/auth/session';
import { useFormSubmit } from '@/lib/forms/useFormSubmit';

const ITEM_KEYS = ['boost', 'super_like', 'spotlight'] as const;

/** `POST admin/billing/grants` (billing.grant): either an entitlement for N days or a consumable quantity. */
export function GrantDialog({ userId, name, onClose, onDone }: { userId: string; name: string; onClose: () => void; onDone: () => void }) {
  const api = useAdminApi();
  const notify = useNotify();
  const { busy, error, fieldErrors, submit } = useFormSubmit();
  const [type, setType] = useState<'entitlement' | 'consumable'>('entitlement');
  const [entitlementKey, setEntitlementKey] = useState<string>(ENTITLEMENT_KEYS[0]);
  const [days, setDays] = useState<number | undefined>(30);
  const [itemKey, setItemKey] = useState<string>(ITEM_KEYS[0]);
  const [quantity, setQuantity] = useState<number | undefined>(1);
  const [reasonKey, setReasonKey] = useState('');

  async function save() {
    const payload = type === 'entitlement'
      ? { userId, entitlementKey, days, reasonKey: reasonKey.trim() }
      : { userId, consumable: { itemKey, quantity }, reasonKey: reasonKey.trim() };
    const ok = await submit(adminGrant, payload, async (d) => {
      await api.users.grant(d);
      notify(t('users.grant.done'));
    });
    if (ok) {
      onDone();
      onClose();
    }
  }

  return (
    <FormDialog title={t('users.grant.title', { name })} onClose={onClose} onSubmit={() => void save()} busy={busy} error={error} fieldErrors={fieldErrors} submitLabel={t('users.grant.submit')}>
      <SelectField
        label={t('users.grant.type')}
        value={type}
        onChange={(v) => setType(v as 'entitlement' | 'consumable')}
        options={[{ value: 'entitlement', label: t('users.grant.typeEntitlement') }, { value: 'consumable', label: t('users.grant.typeConsumable') }]}
      />
      {type === 'entitlement' ? (
        <>
          <SelectField
            label={t('users.grant.entitlementKey')}
            value={entitlementKey}
            onChange={setEntitlementKey}
            error={fieldErrors.entitlementKey}
            options={ENTITLEMENT_KEYS.map((k) => ({ value: k, label: tDynamic(`users.grant.entitlements.${k}`, k) }))}
          />
          <NumberField label={t('users.grant.days')} hint={t('users.grant.daysHint')} value={days} onChange={setDays} error={fieldErrors.days} min={1} max={3650} step={1} />
        </>
      ) : (
        <>
          <SelectField
            label={t('users.grant.itemKey')}
            value={itemKey}
            onChange={setItemKey}
            error={fieldErrors['consumable.itemKey']}
            options={ITEM_KEYS.map((k) => ({ value: k, label: t(`users.grant.items.${k}`) }))}
          />
          <NumberField label={t('users.grant.quantity')} hint={t('users.grant.quantityHint')} value={quantity} onChange={setQuantity} error={fieldErrors['consumable.quantity']} required min={-1000} max={1000} step={1} />
        </>
      )}
      <TextField
        label={t('users.grant.reasonKey')}
        hint={t('users.grant.reasonKeyHint')}
        value={reasonKey}
        onChange={setReasonKey}
        error={fieldErrors.reasonKey}
        required
        maxLength={60}
        spellCheck={false}
        autoComplete="off"
      />
      {fieldErrors[''] ? <p className="field__error" role="alert">{fieldErrors['']}</p> : null}
    </FormDialog>
  );
}
