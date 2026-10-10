'use client';

import { useState, type ReactNode } from 'react';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { BoolBadge } from '@/components/ui/states';
import { t, tDynamic } from '@/i18n';
import type { PaymentItem, PaymentStatus, SubscriptionStatus, UserBilling } from '@/lib/api/modules/billing';
import { useSession } from '@/lib/auth/session';
import { formatDateTime, formatMoney, formatNumber } from '@/lib/format';
import { entitlementLabel, itemLabel, kindLabel, limitLabel, periodLabel, providerLabel } from './labels';
import { canRefundPayment, RefundDialog } from './RefundDialog';

const SUB_TONES: Record<SubscriptionStatus, BadgeTone> = {
  incomplete: 'neutral', trialing: 'info', active: 'success', past_due: 'warning', in_grace: 'warning', paused: 'neutral', canceled: 'neutral', expired: 'neutral', refunded: 'danger',
};
const PAY_TONES: Record<PaymentStatus, BadgeTone> = {
  pending: 'info', succeeded: 'success', failed: 'danger', refunded: 'neutral', partially_refunded: 'warning', disputed: 'danger',
};

function Section({ title, hint, empty, isEmpty, children }: { title: string; hint?: string; empty: string; isEmpty: boolean; children: ReactNode }) {
  return (
    <section className="card" aria-label={title}>
      <h2 className="card__title">{title}</h2>
      {hint ? <p className="muted">{hint}</p> : null}
      {isEmpty ? <p className="muted">{empty}</p> : <div className="table-wrap">{children}</div>}
    </section>
  );
}

/** Read-only billing picture for one user, with per-payment refunds for admins holding billing.refund. */
export function UserBillingDetails({ data, productKeys, onChanged }: { data: UserBilling; productKeys: Map<string, string>; onChanged: () => void }) {
  const canRefund = useSession().can('billing.refund');
  const [refunding, setRefunding] = useState<PaymentItem | null>(null);
  const productName = (id: string | null) => (id ? (productKeys.get(id) ?? id) : '—');

  return (
    <div className="stack">
      <Section title={t('billing.users.subscriptions')} empty={t('billing.users.noSubscriptions')} isEmpty={data.subscriptions.length === 0}>
        <table className="table">
          <thead>
            <tr>
              <th scope="col">{t('billing.users.product')}</th>
              <th scope="col">{t('billing.users.provider')}</th>
              <th scope="col">{t('billing.users.status')}</th>
              <th scope="col">{t('billing.users.period')}</th>
              <th scope="col">{t('billing.users.trialEnd')}</th>
              <th scope="col">{t('billing.users.cancelAtPeriodEnd')}</th>
              <th scope="col">{t('billing.users.created')}</th>
            </tr>
          </thead>
          <tbody>
            {data.subscriptions.map((s) => (
              <tr key={s.id}>
                <td><code>{productName(s.product_id)}</code></td>
                <td>{providerLabel(s.provider)}</td>
                <td><Badge tone={SUB_TONES[s.status] ?? 'neutral'}>{tDynamic(`billing.users.subscriptionStatus.${s.status}`, s.status)}</Badge></td>
                <td>{t('billing.users.periodRange', { start: formatDateTime(s.current_period_start), end: formatDateTime(s.current_period_end) })}</td>
                <td>{formatDateTime(s.trial_end)}</td>
                <td><BoolBadge value={s.cancel_at_period_end} /></td>
                <td>{formatDateTime(s.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title={t('billing.users.payments')} hint={t('billing.users.paymentsHint')} empty={t('billing.users.noPayments')} isEmpty={data.payments.length === 0}>
        <table className="table">
          <thead>
            <tr>
              <th scope="col">{t('billing.users.date')}</th>
              <th scope="col">{t('billing.users.product')}</th>
              <th scope="col">{t('billing.users.kind')}</th>
              <th scope="col">{t('billing.users.provider')}</th>
              <th scope="col" className="num">{t('billing.users.amount')}</th>
              <th scope="col" className="num">{t('billing.users.refunded')}</th>
              <th scope="col">{t('billing.users.status')}</th>
              <th scope="col">{t('billing.users.receipt')}</th>
              <th scope="col"><span className="visually-hidden">{t('common.actions')}</span></th>
            </tr>
          </thead>
          <tbody>
            {data.payments.map((p) => (
              <tr key={p.id}>
                <td>{formatDateTime(p.at)}</td>
                <td>{p.productKey ? <code>{p.productKey}</code> : '—'}</td>
                <td>{kindLabel(p.kind)}</td>
                <td>{providerLabel(p.provider)}</td>
                <td className="num">{formatMoney(p.amountMinor, p.currency)}</td>
                <td className="num">{p.refundedMinor > 0 ? formatMoney(p.refundedMinor, p.currency) : '—'}</td>
                <td><Badge tone={PAY_TONES[p.status] ?? 'neutral'}>{tDynamic(`billing.users.paymentStatus.${p.status}`, p.status)}</Badge></td>
                <td>{p.receiptUrl ? <a href={p.receiptUrl} target="_blank" rel="noopener noreferrer">{t('billing.users.openReceipt')}</a> : '—'}</td>
                <td className="table__actions">
                  {canRefund && canRefundPayment(p) ? (
                    <Button variant="danger" size="sm" onClick={() => setRefunding(p)} aria-label={t('billing.users.refundPayment', { id: p.id })}>{t('billing.users.refund')}</Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title={t('billing.users.entitlements')} empty={t('billing.users.noEntitlements')} isEmpty={data.entitlements.length === 0}>
        <table className="table">
          <thead>
            <tr>
              <th scope="col">{t('billing.users.entitlement')}</th>
              <th scope="col">{t('billing.users.source')}</th>
              <th scope="col">{t('billing.users.limit')}</th>
              <th scope="col">{t('billing.users.starts')}</th>
              <th scope="col">{t('billing.users.ends')}</th>
              <th scope="col">{t('billing.users.revoked')}</th>
            </tr>
          </thead>
          <tbody>
            {data.entitlements.map((e) => (
              <tr key={e.id}>
                <td>{entitlementLabel(e.entitlement_key)}</td>
                <td>{tDynamic(`billing.users.sources.${e.source_type}`, e.source_type)}</td>
                <td>{limitLabel(e.limit_value)}{e.limit_period ? ` (${periodLabel(e.limit_period)})` : ''}</td>
                <td>{formatDateTime(e.starts_at)}</td>
                <td>{e.ends_at ? formatDateTime(e.ends_at) : t('billing.users.never')}</td>
                <td>{e.revoked_at ? formatDateTime(e.revoked_at) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title={t('billing.users.balances')} empty={t('billing.users.noBalances')} isEmpty={data.balances.length === 0}>
        <table className="table table--compact">
          <thead>
            <tr>
              <th scope="col">{t('billing.users.item')}</th>
              <th scope="col" className="num">{t('billing.users.balance')}</th>
            </tr>
          </thead>
          <tbody>
            {data.balances.map((b) => (
              <tr key={b.item_key}>
                <td>{itemLabel(b.item_key)}</td>
                <td className="num">{formatNumber(b.balance, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title={t('billing.users.ledger')} empty={t('billing.users.noLedger')} isEmpty={data.ledger.length === 0}>
        <table className="table table--compact">
          <thead>
            <tr>
              <th scope="col">{t('billing.users.date')}</th>
              <th scope="col">{t('billing.users.item')}</th>
              <th scope="col" className="num">{t('billing.users.delta')}</th>
              <th scope="col">{t('billing.users.reason')}</th>
            </tr>
          </thead>
          <tbody>
            {data.ledger.map((l) => (
              <tr key={l.id}>
                <td>{formatDateTime(l.created_at)}</td>
                <td>{itemLabel(l.item_key)}</td>
                <td className="num">{l.delta > 0 ? `+${formatNumber(l.delta, 0)}` : formatNumber(l.delta, 0)}</td>
                <td>{tDynamic(`billing.users.ledgerReasons.${l.reason}`, l.reason)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {refunding ? <RefundDialog payment={refunding} onClose={() => setRefunding(null)} onDone={onChanged} /> : null}
    </div>
  );
}
