'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { SelectField } from '@/components/ui/fields';
import { BoolBadge, EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui/states';
import { t } from '@/i18n';
import { toNumber, type BillingPriceRow, type BillingProductRow } from '@/lib/api/modules/billing';
import { useAdminApi, useSession } from '@/lib/auth/session';
import { formatMoney, formatNumber } from '@/lib/format';
import { useResource } from '@/lib/hooks/useResource';
import { BillingSection } from './BillingSection';
import { intervalLabel, kindLabel, providerLabel } from './labels';
import { PriceDialog } from './PriceDialog';

export function PricesPage() {
  return (
    <BillingSection permission="billing.view">
      <PricesView />
    </BillingSection>
  );
}

function intervalText(p: BillingPriceRow): string {
  if (!p.billing_interval) return t('billing.prices.noInterval');
  const count = p.interval_count ?? 1;
  return count > 1 ? t('billing.prices.every', { count, interval: intervalLabel(p.billing_interval) }) : intervalLabel(p.billing_interval);
}

function PricesView() {
  const api = useAdminApi();
  const router = useRouter();
  const params = useSearchParams();
  const canManage = useSession().can('billing.plans.manage');
  const data = useResource(() => api.billing.products(), [api]);
  const [selected, setSelected] = useState(() => params.get('product') ?? '');
  const [editing, setEditing] = useState<BillingPriceRow | 'new' | null>(null);

  const products = data.status === 'success' ? data.data : [];
  const product: BillingProductRow | undefined = products.find((p) => p.key === selected) ?? products[0];

  function choose(key: string) {
    setSelected(key);
    router.replace(`/billing/prices?product=${encodeURIComponent(key)}`);
  }

  return (
    <>
      <PageHeader
        title={t('billing.prices.title')}
        intro={t('billing.prices.intro')}
        actions={canManage && product ? <Button onClick={() => setEditing('new')}>{t('billing.prices.newPrice')}</Button> : null}
      />
      {data.status === 'loading' ? <LoadingState /> : null}
      {data.status === 'error' ? <ErrorState error={data.error} onRetry={data.reload} /> : null}
      {data.status === 'success' && !product ? <EmptyState message={t('billing.prices.noProducts')} /> : null}
      {product ? (
        <>
          <div className="filters">
            <SelectField
              className="field--inline"
              label={t('billing.prices.product')}
              value={product.key}
              onChange={choose}
              options={products.map((p) => ({ value: p.key, label: `${p.key} (${kindLabel(p.kind)})` }))}
            />
          </div>
          {product.prices.length === 0 ? <EmptyState message={t('billing.prices.empty')} /> : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">{t('billing.prices.provider')}</th>
                    <th scope="col">{t('billing.prices.providerPriceId')}</th>
                    <th scope="col" className="num">{t('billing.prices.amount')}</th>
                    <th scope="col">{t('billing.prices.interval')}</th>
                    <th scope="col" className="num">{t('billing.prices.trialDays')}</th>
                    <th scope="col" className="num">{t('billing.prices.quantity')}</th>
                    <th scope="col">{t('billing.prices.countries')}</th>
                    <th scope="col">{t('billing.prices.active')}</th>
                    <th scope="col"><span className="visually-hidden">{t('common.actions')}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {product.prices.map((p) => (
                    <tr key={p.id}>
                      <td>{providerLabel(p.provider)}</td>
                      <td><code>{p.provider_price_id}</code></td>
                      <td className="num">{formatMoney(toNumber(p.amount_minor), p.currency.trim())}</td>
                      <td>{intervalText(p)}</td>
                      <td className="num">{formatNumber(p.trial_days, 0)}</td>
                      <td className="num">{formatNumber(p.quantity, 0)}</td>
                      <td>{p.country_codes?.length ? p.country_codes.map((c) => c.trim()).join(', ') : t('billing.prices.allCountries')}</td>
                      <td><BoolBadge value={p.is_active} on={t('common.active')} off={t('common.inactive')} /></td>
                      <td className="table__actions">
                        {canManage ? (
                          <Button variant="ghost" size="sm" onClick={() => setEditing(p)} aria-label={`${t('common.edit')} ${p.provider_price_id}`}>{t('common.edit')}</Button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
      {editing && product ? (
        <PriceDialog product={product} price={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={data.reload} />
      ) : null}
    </>
  );
}
