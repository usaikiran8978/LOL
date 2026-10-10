'use client';

import { adminRefund } from '@amora/shared';
import { useState } from 'react';
import { useNotify } from '@/components/shell/notice';
import { DefinitionList } from '@/components/ui/DefinitionList';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { NumberField, TextAreaField } from '@/components/ui/fields';
import { t } from '@/i18n';
import type { PaymentItem, RefundResult } from '@/lib/api/modules/billing';
import { useAdminApi } from '@/lib/auth/session';
import { formatMoney } from '@/lib/format';
import { validate, type FieldErrors } from '@/lib/forms/validate';
import { providerLabel } from './labels';

export const refundableMinor = (p: PaymentItem) => Math.max(0, p.amountMinor - p.refundedMinor);

/** The API only refunds succeeded / partially refunded payments with money left to return. */
export const canRefundPayment = (p: PaymentItem) => (p.status === 'succeeded' || p.status === 'partially_refunded') && refundableMinor(p) > 0;

function resultMessage(p: PaymentItem, amount: number, r: RefundResult): string {
  if (r.status === 'requested') return p.provider === 'apple' ? t('billing.refund.doneApple') : p.provider === 'google' ? t('billing.refund.doneGoogle') : t('billing.refund.storeNotice');
  return t('billing.refund.doneStripe', { amount: formatMoney(amount, p.currency), status: r.status });
}

/**
 * Irreversible money movement: shows what was paid / already refunded, takes an optional partial amount in minor
 * units, and requires the typed confirmation phrase before calling the API.
 */
export function RefundDialog({ payment, onClose, onDone }: { payment: PaymentItem; onClose: () => void; onDone: () => void }) {
  const api = useAdminApi();
  const notify = useNotify();
  const [amount, setAmount] = useState<number | undefined>();
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const remaining = refundableMinor(payment);
  const money = (minor: number) => formatMoney(minor, payment.currency);
  const effective = amount ?? remaining;

  async function confirm(): Promise<boolean> {
    const v = validate(adminRefund, { amountMinor: amount, reason: reason.trim() });
    const errs: FieldErrors = v.ok ? {} : { ...v.errors };
    if (amount !== undefined && amount > remaining) errs.amountMinor = t('billing.refund.tooMuch', { amount: money(remaining) });
    if (!reason.trim()) errs.reason = t('validation.required');
    setErrors(errs);
    if (!v.ok || Object.keys(errs).length) return false;
    const result = await api.billing.refund(payment.id, v.data);
    notify(resultMessage(payment, v.data.amountMinor ?? remaining, result));
    onDone();
    return true;
  }

  return (
    <ConfirmDialog
      title={t('billing.refund.title')}
      tone="danger"
      body={
        <>
          <p>{t('billing.refund.body')}</p>
          <DefinitionList
            items={[
              { label: t('billing.refund.provider'), value: providerLabel(payment.provider) },
              { label: t('billing.refund.paid'), value: money(payment.amountMinor) },
              { label: t('billing.refund.alreadyRefunded'), value: money(payment.refundedMinor) },
              { label: t('billing.refund.refundable'), value: money(remaining) },
            ]}
          />
        </>
      }
      confirmLabel={t('billing.refund.confirm', { amount: money(effective) })}
      confirmPhrase={t('billing.refund.phrase')}
      onConfirm={confirm}
      onClose={onClose}
    >
      <NumberField
        label={t('billing.refund.amountMinor')}
        hint={amount === undefined ? t('billing.refund.amountHint', { amount: money(remaining) }) : t('billing.refund.willRefund', { amount: money(amount) })}
        value={amount}
        onChange={setAmount}
        min={1}
        max={remaining}
        step={1}
        error={errors.amountMinor}
      />
      <TextAreaField label={t('billing.refund.reason')} hint={t('billing.refund.reasonHint')} value={reason} onChange={setReason} error={errors.reason} rows={2} maxLength={300} required />
    </ConfirmDialog>
  );
}
