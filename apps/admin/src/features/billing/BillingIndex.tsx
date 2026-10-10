'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { LoadingState } from '@/components/ui/states';
import { t } from '@/i18n';
import { useSession } from '@/lib/auth/session';
import { ProductsPage } from './ProductsPage';

/**
 * `/billing`: the plans catalogue for admins with billing.view. Coupon managers without billing.view are sent
 * to the coupons page (the only billing list they can read); anyone else sees the permission notice.
 */
export function BillingIndex() {
  const { can } = useSession();
  const router = useRouter();
  const redirect = !can('billing.view') && can('billing.coupons.manage');

  useEffect(() => {
    if (redirect) router.replace('/billing/coupons');
  }, [redirect, router]);

  if (redirect) return <LoadingState label={t('billing.redirecting')} />;
  return <ProductsPage />;
}
