'use client';

import type { Permission } from '@amora/shared';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Forbidden } from '@/components/shell/RouteGuard';
import { SectionTabs, type SectionTab } from '@/components/ui/SectionTabs';
import { LoadingState } from '@/components/ui/states';
import { t } from '@/i18n';
import { useSession } from '@/lib/auth/session';

/** Dates sub-pages; both are guarded by `date_safety.manage` in the API. */
export function datesTabs(): Array<SectionTab & { anyOf: Permission[] }> {
  return [
    { href: '/dates/safety', label: t('dates.tabs.safety'), anyOf: ['date_safety.manage'] },
    { href: '/dates/ideas', label: t('dates.tabs.ideas'), anyOf: ['date_safety.manage'] },
  ];
}

export function DatesTabs() {
  return <SectionTabs tabs={datesTabs()} label={t('dates.tabs.label')} />;
}

/** `/dates` has no content of its own: it forwards to the first sub-page the admin may open. */
export function DatesIndex() {
  const router = useRouter();
  const { admin } = useSession();
  const perms = admin?.permissions ?? [];
  const target = datesTabs().find((tab) => tab.anyOf.some((p) => perms.includes(p)))?.href;
  useEffect(() => {
    if (target) router.replace(target);
  }, [target, router]);
  if (!target) return <Forbidden permission="date_safety.manage" />;
  return <LoadingState />;
}
