'use client';

import { RequirePermission } from '@/components/shell/RouteGuard';
import { SectionTabs, type SectionTab } from '@/components/ui/SectionTabs';
import { t } from '@/i18n';
import { useSession } from '@/lib/auth/session';
import { PrivacyRequestsPage } from './PrivacyRequestsPage';
import { RetentionPage } from './RetentionPage';

export function PrivacyTabs() {
  const tabs: SectionTab[] = [
    { href: '/privacy', label: t('privacy.tabs.requests'), anyOf: ['privacy.requests'], exact: true },
    { href: '/privacy/retention', label: t('privacy.tabs.retention'), anyOf: ['privacy.retention.manage'] },
  ];
  return <SectionTabs tabs={tabs} label={t('privacy.tabs.label')} />;
}

/**
 * `/privacy` is reachable with either privacy permission (nav anyOf). Admins who can only manage retention land
 * directly on the retention policies instead of a forbidden queue.
 */
export function PrivacyHome() {
  const { can, admin } = useSession();
  if (!can('privacy.requests') && can('privacy.retention.manage')) return <RetentionRoute />;
  return (
    <>
      <PrivacyTabs />
      <RequirePermission permission="privacy.requests" permissions={admin?.permissions ?? []}>
        <PrivacyRequestsPage />
      </RequirePermission>
    </>
  );
}

export function RetentionRoute() {
  const { admin } = useSession();
  return (
    <>
      <PrivacyTabs />
      <RequirePermission permission="privacy.retention.manage" permissions={admin?.permissions ?? []}>
        <RetentionPage />
      </RequirePermission>
    </>
  );
}
