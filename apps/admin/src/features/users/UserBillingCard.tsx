'use client';

import { Badge } from '@/components/ui/Badge';
import { BoolBadge, EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { t, tDynamic } from '@/i18n';
import type { UserBilling } from '@/lib/api/modules/users';
import { useAdminApi } from '@/lib/auth/session';
import { formatDateTime, formatMoney, formatNumber } from '@/lib/format';
import { useResource } from '@/lib/hooks/useResource';
import { Card } from './UserSections';

const entitlementLabel = (k: string) => tDynamic(`users.grant.entitlements.${k}`, k);
const itemLabel = (k: string) => tDynamic(`users.grant.items.${k}`, k);

/** Subscription / entitlement overview (`billing.view`). `version` changes force a refetch (e.g. after a grant). */
export function UserBillingCard({ userId, version }: { userId: string; version: number }) {
  const api = useAdminApi();
  const billing = useResource(() => api.users.billing(userId), [api, userId, version]);
  return (
    <Card title={t('users.billing.title')} id="user-billing">
      {billing.status === 'loading' ? <LoadingState /> : null}
      {billing.status === 'error' ? <ErrorState error={billing.error} onRetry={billing.reload} /> : null}
      {billing.status === 'success' ? <BillingTables data={billing.data} /> : null}
    </Card>
  );
}

function BillingTables({ data }: { data: UserBilling }) {
  const now = Date.now();
  return (
    <div className="stack">
      <h3>{t('users.billing.subscriptions')}</h3>
      {data.subscriptions.length === 0 ? <EmptyState message={t('users.billing.noSubscriptions')} /> : (
        <div className="table-wrap">
          <table className="table table--compact">
            <thead>
              <tr>
                <th scope="col">{t('users.billing.provider')}</th>
                <th scope="col">{t('common.status')}</th>
                <th scope="col">{t('users.billing.periodEnd')}</th>
                <th scope="col">{t('users.billing.cancelAtPeriodEnd')}</th>
                <th scope="col">{t('users.billing.trialEnd')}</th>
              </tr>
            </thead>
            <tbody>
              {data.subscriptions.map((s) => (
                <tr key={s.id}>
                  <td>{s.provider}</td>
                  <td><code>{s.status}</code></td>
                  <td>{formatDateTime(s.current_period_end)}</td>
                  <td><BoolBadge value={s.cancel_at_period_end} /></td>
                  <td>{formatDateTime(s.trial_end)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3>{t('users.billing.entitlements')}</h3>
      {data.entitlements.length === 0 ? <EmptyState message={t('users.billing.noEntitlements')} /> : (
        <div className="table-wrap">
          <table className="table table--compact">
            <thead>
              <tr>
                <th scope="col">{t('users.billing.entitlement')}</th>
                <th scope="col">{t('users.billing.source')}</th>
                <th scope="col">{t('users.billing.startsAt')}</th>
                <th scope="col">{t('users.billing.endsAt')}</th>
                <th scope="col">{t('common.status')}</th>
              </tr>
            </thead>
            <tbody>
              {data.entitlements.map((e) => {
                const ended = !!e.ends_at && new Date(e.ends_at).getTime() <= now;
                return (
                  <tr key={e.id}>
                    <td>{entitlementLabel(e.entitlement_key)}</td>
                    <td><code>{e.source_type}</code></td>
                    <td>{formatDateTime(e.starts_at)}</td>
                    <td>{e.ends_at ? formatDateTime(e.ends_at) : t('users.billing.noEnd')}</td>
                    <td>
                      {e.revoked_at ? <Badge tone="danger">{t('users.billing.revoked', { date: formatDateTime(e.revoked_at) })}</Badge>
                        : ended ? <Badge>{t('common.inactive')}</Badge>
                          : <Badge tone="success">{t('users.billing.activeNow')}</Badge>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <h3>{t('users.billing.balances')}</h3>
      {data.balances.length === 0 ? <EmptyState message={t('users.billing.noBalances')} /> : (
        <div className="table-wrap">
          <table className="table table--compact">
            <thead>
              <tr>
                <th scope="col">{t('users.billing.item')}</th>
                <th scope="col">{t('users.billing.balance')}</th>
              </tr>
            </thead>
            <tbody>
              {data.balances.map((b) => (
                <tr key={b.item_key}>
                  <td>{itemLabel(b.item_key)}</td>
                  <td className="num">{formatNumber(b.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3>{t('users.billing.payments')}</h3>
      {data.payments.length === 0 ? <EmptyState message={t('users.billing.noPayments')} /> : (
        <div className="table-wrap">
          <table className="table table--compact">
            <thead>
              <tr>
                <th scope="col">{t('users.billing.date')}</th>
                <th scope="col">{t('users.billing.product')}</th>
                <th scope="col">{t('users.billing.amount')}</th>
                <th scope="col">{t('users.billing.refunded')}</th>
                <th scope="col">{t('common.status')}</th>
              </tr>
            </thead>
            <tbody>
              {data.payments.map((p) => (
                <tr key={p.id}>
                  <td>{formatDateTime(p.at)}</td>
                  <td>{p.productKey ? <code>{p.productKey}</code> : '—'}</td>
                  <td className="num">{formatMoney(p.amountMinor, p.currency)}</td>
                  <td className="num">{p.refundedMinor ? formatMoney(p.refundedMinor, p.currency) : '—'}</td>
                  <td><code>{p.status}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
