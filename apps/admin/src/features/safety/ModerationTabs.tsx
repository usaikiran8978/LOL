'use client';

import type { Permission } from '@amora/shared';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { SectionTabs, type SectionTab } from '@/components/ui/SectionTabs';
import { LoadingState } from '@/components/ui/states';
import { Forbidden } from '@/components/shell/RouteGuard';
import { t } from '@/i18n';
import { useSession } from '@/lib/auth/session';

/** Moderation sub-pages, each gated by the permission its API endpoints require. */
export function moderationTabs(): Array<SectionTab & { anyOf: Permission[] }> {
  return [
    { href: '/moderation/cases', label: t('safety.tabs.cases'), anyOf: ['moderation.view'] },
    { href: '/moderation/reports', label: t('safety.tabs.reports'), anyOf: ['moderation.view'] },
    { href: '/moderation/risk-scores', label: t('safety.tabs.riskScores'), anyOf: ['moderation.view'] },
    { href: '/moderation/appeals', label: t('safety.tabs.appeals'), anyOf: ['moderation.appeals'] },
    { href: '/moderation/profile-review', label: t('safety.tabs.profileReview'), anyOf: ['profiles.review'] },
    { href: '/moderation/rules', label: t('safety.tabs.rules'), anyOf: ['moderation.rules.manage'] },
    { href: '/moderation/thresholds', label: t('safety.tabs.thresholds'), anyOf: ['moderation.rules.manage'] },
  ];
}

export function ModerationTabs() {
  return <SectionTabs tabs={moderationTabs()} label={t('safety.tabs.label')} />;
}

/** `/moderation` has no content of its own: it forwards to the first sub-page the admin may open. */
export function ModerationIndex() {
  const router = useRouter();
  const { admin } = useSession();
  const perms = admin?.permissions ?? [];
  const target = moderationTabs().find((tab) => tab.anyOf.some((p) => perms.includes(p)))?.href;
  useEffect(() => {
    if (target) router.replace(target);
  }, [target, router]);
  if (!target) return <Forbidden permission={moderationTabs().flatMap((x) => x.anyOf).join(' / ')} />;
  return <LoadingState />;
}
