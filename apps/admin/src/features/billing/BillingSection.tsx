'use client';

import type { Permission } from '@amora/shared';
import type { ReactNode } from 'react';
import { RequirePermission } from '@/components/shell/RouteGuard';
import { SectionTabs, type SectionTab } from '@/components/ui/SectionTabs';
import { t } from '@/i18n';
import { useSession } from '@/lib/auth/session';

/** Sub-pages of /billing, each shown only to admins holding the permission its list endpoint requires. */
export function billingTabs(): SectionTab[] {
  return [
    { href: '/billing', label: t('billing.tabs.products'), anyOf: ['billing.view'], exact: true },
    { href: '/billing/prices', label: t('billing.tabs.prices'), anyOf: ['billing.view'] },
    { href: '/billing/free-tier', label: t('billing.tabs.freeTier'), anyOf: ['billing.view'] },
    { href: '/billing/coupons', label: t('billing.tabs.coupons'), anyOf: ['billing.coupons.manage'] },
    { href: '/billing/users', label: t('billing.tabs.users'), anyOf: ['billing.view'] },
    { href: '/billing/webhooks', label: t('billing.tabs.webhooks'), anyOf: ['billing.view'] },
  ];
}

/**
 * Section tabs + page-level guard. The nav item admits any billing permission, so each sub-page re-checks the
 * narrower permission its GET endpoint needs; children only mount (and fetch) when it is held.
 */
export function BillingSection({ permission, children }: { permission: Permission; children: ReactNode }) {
  const { admin } = useSession();
  return (
    <>
      <SectionTabs tabs={billingTabs()} label={t('billing.sectionsLabel')} />
      <RequirePermission permission={permission} permissions={admin?.permissions ?? []}>{children}</RequirePermission>
    </>
  );
}
