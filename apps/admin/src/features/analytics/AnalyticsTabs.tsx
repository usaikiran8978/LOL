'use client';

import { SectionTabs } from '@/components/ui/SectionTabs';
import { t } from '@/i18n';

/** Links the dashboard, metric explorer and experiments pages (each filtered by its nav permission). */
export function AnalyticsTabs() {
  return (
    <SectionTabs
      label={t('analytics.tabs.label')}
      tabs={[
        { href: '/dashboard', label: t('analytics.tabs.dashboard'), anyOf: ['dashboard.view'] },
        { href: '/analytics', label: t('analytics.tabs.metrics'), anyOf: ['analytics.view'] },
        { href: '/experiments', label: t('analytics.tabs.experiments'), anyOf: ['analytics.view'] },
      ]}
    />
  );
}
