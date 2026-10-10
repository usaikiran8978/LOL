'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { BoolBadge, EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui/states';
import { t, tDynamic } from '@/i18n';
import { toNumber, type CouponRow } from '@/lib/api/modules/billing';
import { useAdminApi, useSession } from '@/lib/auth/session';
import { formatDateTime, formatNumber } from '@/lib/format';
import { useResource } from '@/lib/hooks/useResource';
import { BillingSection } from './BillingSection';
import { CouponDialog } from './CouponDialog';

export function CouponsPage() {
  return (
    <BillingSection permission="billing.coupons.manage">
      <CouponsView />
    </BillingSection>
  );
}

function validity(c: CouponRow): string {
  const from = t('billing.coupons.from', { date: formatDateTime(c.valid_from) });
  return `${from}, ${c.valid_until ? t('billing.coupons.until', { date: formatDateTime(c.valid_until) }) : t('billing.coupons.openEnded')}`;
}

function CouponsView() {
  const api = useAdminApi();
  const canViewCatalogue = useSession().can('billing.view');
  const data = useResource(async () => {
    // Product keys for the restriction checklist need billing.view; without it the key is typed by hand.
    const [coupons, products] = await Promise.all([api.billing.coupons(), canViewCatalogue ? api.billing.products() : Promise.resolve(null)]);
    return { coupons, productKeys: products ? products.map((p) => p.key) : null };
  }, [api, canViewCatalogue]);
  const [editing, setEditing] = useState<CouponRow | 'new' | null>(null);

  return (
    <>
      <PageHeader title={t('billing.coupons.title')} intro={t('billing.coupons.intro')} actions={<Button onClick={() => setEditing('new')}>{t('billing.coupons.newCoupon')}</Button>} />
      {data.status === 'loading' ? <LoadingState /> : null}
      {data.status === 'error' ? <ErrorState error={data.error} onRetry={data.reload} /> : null}
      {data.status === 'success' && data.data.coupons.length === 0 ? <EmptyState message={t('billing.coupons.empty')} /> : null}
      {data.status === 'success' && data.data.coupons.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('billing.coupons.code')}</th>
                <th scope="col">{t('common.description')}</th>
                <th scope="col">{t('billing.coupons.discountType')}</th>
                <th scope="col">{t('billing.coupons.validity')}</th>
                <th scope="col" className="num">{t('billing.coupons.redemptions')}</th>
                <th scope="col">{t('billing.coupons.active')}</th>
                <th scope="col"><span className="visually-hidden">{t('common.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {data.data.coupons.map((c) => {
                const used = formatNumber(toNumber(c.redemptions) ?? 0, 0);
                return (
                  <tr key={c.id}>
                    <td><code>{c.code}</code></td>
                    <td>{c.description ?? '—'}</td>
                    <td>{tDynamic(`billing.coupons.types.${c.discount_type}`, c.discount_type)}</td>
                    <td>{validity(c)}</td>
                    <td className="num">{c.max_redemptions === null ? used : t('billing.coupons.redemptionsOf', { count: used, max: formatNumber(c.max_redemptions, 0) })}</td>
                    <td><BoolBadge value={c.is_active} on={t('common.active')} off={t('common.inactive')} /></td>
                    <td className="table__actions">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(c)} aria-label={`${t('common.edit')} ${c.code}`}>{t('common.edit')}</Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {editing && data.status === 'success' ? (
        <CouponDialog coupon={editing === 'new' ? null : editing} productKeys={data.data.productKeys} onClose={() => setEditing(null)} onSaved={data.reload} />
      ) : null}
    </>
  );
}
