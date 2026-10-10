'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { BoolBadge, EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui/states';
import { t } from '@/i18n';
import type { BillingProductRow } from '@/lib/api/modules/billing';
import { useAdminApi, useSession } from '@/lib/auth/session';
import { formatNumber } from '@/lib/format';
import { useResource } from '@/lib/hooks/useResource';
import { BillingSection } from './BillingSection';
import { entitlementLabel, itemLabel, kindLabel, limitLabel, periodLabel, tierLabel } from './labels';
import { ProductDialog } from './ProductDialog';

export function ProductsPage() {
  return (
    <BillingSection permission="billing.view">
      <ProductsView />
    </BillingSection>
  );
}

function grantsSummary(p: BillingProductRow): string {
  if (p.kind === 'consumable' && p.consumable_item_key) {
    return `${formatNumber(p.consumable_quantity ?? 0, 0)} × ${itemLabel(p.consumable_item_key)}`;
  }
  if (p.entitlements.length === 0) return '—';
  return p.entitlements
    .map((e) => (e.limit_value === null && !e.limit_period ? entitlementLabel(e.entitlement_key) : `${entitlementLabel(e.entitlement_key)} (${limitLabel(e.limit_value)}${e.limit_period ? `, ${periodLabel(e.limit_period)}` : ''})`))
    .join(', ');
}

function ProductsView() {
  const api = useAdminApi();
  const canManage = useSession().can('billing.plans.manage');
  const data = useResource(() => api.billing.products(), [api]);
  const [editing, setEditing] = useState<BillingProductRow | 'new' | null>(null);

  return (
    <>
      <PageHeader
        title={t('billing.products.title')}
        intro={t('billing.products.intro')}
        actions={canManage ? <Button onClick={() => setEditing('new')}>{t('billing.products.newProduct')}</Button> : null}
      />
      {data.status === 'loading' ? <LoadingState /> : null}
      {data.status === 'error' ? <ErrorState error={data.error} onRetry={data.reload} /> : null}
      {data.status === 'success' && data.data.length === 0 ? <EmptyState message={t('billing.products.empty')} /> : null}
      {data.status === 'success' && data.data.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('billing.products.key')}</th>
                <th scope="col">{t('billing.products.name')}</th>
                <th scope="col">{t('billing.products.kind')}</th>
                <th scope="col">{t('billing.products.tier')}</th>
                <th scope="col" className="num">{t('billing.products.rank')}</th>
                <th scope="col">{t('billing.products.grants')}</th>
                <th scope="col">{t('billing.products.managePrices')}</th>
                <th scope="col">{t('billing.products.active')}</th>
                <th scope="col"><span className="visually-hidden">{t('common.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((p) => (
                <tr key={p.id}>
                  <td><code>{p.key}</code></td>
                  <td dir="auto">{p.translations.en?.name ?? '—'}</td>
                  <td>{kindLabel(p.kind)}</td>
                  <td>{tierLabel(p.tier)}</td>
                  <td className="num">{formatNumber(p.rank, 0)}</td>
                  <td>{grantsSummary(p)}</td>
                  <td>
                    <Link href={`/billing/prices?product=${encodeURIComponent(p.key)}`} aria-label={t('billing.products.managePricesFor', { key: p.key })}>
                      {t('billing.products.pricesCount', { count: p.prices.length })}
                    </Link>
                  </td>
                  <td><BoolBadge value={p.is_active} on={t('common.active')} off={t('common.inactive')} /></td>
                  <td className="table__actions">
                    {canManage ? (
                      <Button variant="ghost" size="sm" onClick={() => setEditing(p)} aria-label={`${t('common.edit')} ${p.key}`}>{t('common.edit')}</Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {editing ? <ProductDialog product={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={data.reload} /> : null}
    </>
  );
}
