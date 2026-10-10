'use client';

import { SectionTabs } from '@/components/ui/SectionTabs';
import { t } from '@/i18n';

export function AdminsTabs() {
  return (
    <SectionTabs
      label={t('admins.tabs.label')}
      tabs={[
        { href: '/admins', label: t('admins.tabs.admins'), anyOf: ['admins.manage'], exact: true },
        { href: '/admins/roles', label: t('admins.tabs.roles'), anyOf: ['admins.manage'] },
      ]}
    />
  );
}
