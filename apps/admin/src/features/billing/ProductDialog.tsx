'use client';

import { adminProductUpsert } from '@amora/shared';
import { useState } from 'react';
import {
  TranslationEditor, translationsFromServer, translationsToPayload, type TranslationFieldSpec, type TranslationValues,
} from '@/components/editors/TranslationEditor';
import { FormDialog } from '@/components/ui/FormDialog';
import { CheckboxField, NumberField, ReadOnlyField, SelectField, TextField } from '@/components/ui/fields';
import { t } from '@/i18n';
import type { BillingProductRow, ConsumableItem, ProductKind, ProductTier } from '@/lib/api/modules/billing';
import { useAdminApi } from '@/lib/auth/session';
import { scopedErrors, type FieldErrors } from '@/lib/forms/validate';
import { duplicateEntitlementErrors, EntitlementsEditor, entitlementsPayload, type EntitlementDraft } from './EntitlementsEditor';
import { itemOptions, kindLabel, kindOptions, rowId, tierOptions } from './labels';
import { useLiveSave } from './useLiveSave';

type TrField = 'name' | 'description';
const TR_FIELDS: readonly TranslationFieldSpec<TrField>[] = [
  { name: 'name', labelKey: 'billing.products.nameField', maxLength: 100 },
  { name: 'description', labelKey: 'billing.products.descriptionField', kind: 'textarea', optional: true, maxLength: 500 },
];

interface ProductForm {
  key: string;
  kind: ProductKind;
  tier: ProductTier | '';
  rank: number | undefined;
  isActive: boolean;
  translations: TranslationValues<TrField>;
  entitlements: EntitlementDraft[];
  consumableItem: ConsumableItem | '';
  consumableQuantity: number | undefined;
}

function toForm(p: BillingProductRow | null): ProductForm {
  if (!p) {
    return {
      key: '', kind: 'subscription', tier: '', rank: 0, isActive: true, translations: translationsFromServer(TR_FIELDS, undefined),
      entitlements: [], consumableItem: '', consumableQuantity: undefined,
    };
  }
  return {
    key: p.key,
    kind: p.kind,
    tier: p.tier ?? '',
    rank: p.rank,
    isActive: p.is_active,
    translations: translationsFromServer(TR_FIELDS, p.translations),
    entitlements: p.entitlements.map((e) => ({ id: rowId(), key: e.entitlement_key, limit: e.limit_value ?? undefined, period: e.limit_period ?? '' })),
    consumableItem: p.consumable_item_key ?? '',
    consumableQuantity: p.consumable_quantity ?? undefined,
  };
}

export function ProductDialog({ product, onClose, onSaved }: { product: BillingProductRow | null; onClose: () => void; onSaved: () => void }) {
  const api = useAdminApi();
  const save = useLiveSave(() => {
    onSaved();
    onClose();
  });
  const [form, setForm] = useState<ProductForm>(() => toForm(product));
  const set = <K extends keyof ProductForm>(k: K) => (v: ProductForm[K]) => setForm((s) => ({ ...s, [k]: v }));
  const errors = save.fieldErrors;
  const consumable = form.kind === 'consumable';

  function submit() {
    const payload = {
      key: form.key.trim(),
      kind: form.kind,
      tier: form.tier || null,
      rank: form.rank,
      isActive: form.isActive,
      translations: translationsToPayload(TR_FIELDS, form.translations),
      entitlements: entitlementsPayload(form.entitlements),
      // The API rejects consumables without a grant; other kinds never carry one.
      consumableGrant: consumable ? { itemKey: form.consumableItem || undefined, quantity: form.consumableQuantity } : null,
    };
    const extra: FieldErrors = { ...duplicateEntitlementErrors(form.entitlements) };
    save.review(adminProductUpsert, payload, (data) => api.billing.upsertProduct(data), extra);
  }

  return (
    <>
      <FormDialog
        title={product ? t('billing.products.editProduct', { key: product.key }) : t('billing.products.newProduct')}
        onClose={onClose}
        onSubmit={submit}
        busy={save.busy}
        error={save.error}
        fieldErrors={errors}
        size="lg"
      >
        {product ? (
          <div className="grid grid--2">
            <ReadOnlyField label={t('billing.products.key')} value={product.key} hint={t('common.immutableHint')} />
            <ReadOnlyField label={t('billing.products.kind')} value={kindLabel(product.kind)} hint={t('common.immutableHint')} />
          </div>
        ) : (
          <div className="grid grid--2">
            <TextField label={t('billing.products.key')} hint={t('billing.products.keyHint')} value={form.key} onChange={set('key')} error={errors.key} required data-autofocus spellCheck={false} maxLength={64} />
            <SelectField label={t('billing.products.kind')} value={form.kind} onChange={(v) => set('kind')(v as ProductKind)} options={kindOptions()} error={errors.kind} required />
          </div>
        )}
        <div className="grid grid--3">
          <SelectField label={t('billing.products.tier')} value={form.tier} onChange={(v) => set('tier')(v as ProductTier | '')} options={tierOptions()} placeholder={t('billing.products.noTier')} error={errors.tier} />
          <NumberField label={t('billing.products.rank')} hint={t('billing.products.rankHint')} value={form.rank} onChange={set('rank')} min={0} step={1} error={errors.rank} required />
          <CheckboxField label={t('billing.products.active')} hint={t('billing.products.activeHint')} checked={form.isActive} onChange={set('isActive')} />
        </div>
        {consumable ? (
          <fieldset className="rules">
            <legend>{t('billing.products.consumableGrant')}</legend>
            {errors.consumableGrant ? <p className="field__error" role="alert">{t('billing.products.consumableRequired')}</p> : null}
            <div className="grid grid--2">
              <SelectField label={t('billing.products.consumableItem')} value={form.consumableItem} onChange={(v) => set('consumableItem')(v as ConsumableItem | '')} options={itemOptions()} placeholder={t('common.none')} error={errors['consumableGrant.itemKey']} required />
              <NumberField label={t('billing.products.consumableQuantity')} value={form.consumableQuantity} onChange={set('consumableQuantity')} min={1} max={1000} step={1} error={errors['consumableGrant.quantity']} required />
            </div>
          </fieldset>
        ) : null}
        <TranslationEditor fields={TR_FIELDS} value={form.translations} onChange={set('translations')} errors={scopedErrors(errors, 'translations')} />
        <EntitlementsEditor rows={form.entitlements} onChange={set('entitlements')} errors={errors} />
      </FormDialog>
      {save.confirmDialog}
    </>
  );
}
