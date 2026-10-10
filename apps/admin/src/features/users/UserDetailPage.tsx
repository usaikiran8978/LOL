'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { ErrorState, LoadingState, PageHeader } from '@/components/ui/states';
import { t } from '@/i18n';
import { useAdminApi, useSession } from '@/lib/auth/session';
import { useResource } from '@/lib/hooks/useResource';
import { statusLabel, statusTone } from './labels';
import { UserActionsCard } from './UserActionsCard';
import { UserBillingCard } from './UserBillingCard';
import { UserLocationCard } from './UserLocationCard';
import { AccountCard, ActivityCard, ProfileCard, RestrictionsCard, SafetyCard, SessionsCard, VerificationCard } from './UserSections';

export function UserDetailPage({ userId }: { userId: string }) {
  const api = useAdminApi();
  const { can } = useSession();
  const detail = useResource(() => api.users.detail(userId), [api, userId]);
  // Bumped after a grant so the billing card refetches without reloading the whole page.
  const [billingVersion, setBillingVersion] = useState(0);

  return (
    <>
      <p><Link href="/users">{t('users.detail.back')}</Link></p>
      {detail.status === 'loading' ? <LoadingState /> : null}
      {detail.status === 'error' ? <ErrorState error={detail.error} onRetry={detail.reload} /> : null}
      {detail.status === 'success' ? (
        <>
          <PageHeader
            title={detail.data.profile?.display_name ?? t('users.detail.titleFallback', { id: detail.data.id })}
            actions={<Badge tone={statusTone(detail.data.status)}>{statusLabel(detail.data.status)}</Badge>}
          />
          <div className="stack">
            <UserActionsCard user={detail.data} onChanged={detail.reload} onGranted={() => setBillingVersion((v) => v + 1)} />
            <div className="grid grid--2">
              <AccountCard user={detail.data} />
              <ProfileCard user={detail.data} />
            </div>
            <ActivityCard user={detail.data} />
            <SessionsCard user={detail.data} />
            <RestrictionsCard user={detail.data} />
            <VerificationCard user={detail.data} />
            <SafetyCard user={detail.data} />
            {can('billing.view') ? <UserBillingCard userId={detail.data.id} version={billingVersion} /> : null}
            {can('users.view_location') ? <UserLocationCard userId={detail.data.id} /> : null}
          </div>
        </>
      ) : null}
    </>
  );
}
