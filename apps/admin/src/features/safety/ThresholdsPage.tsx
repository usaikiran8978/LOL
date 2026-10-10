'use client';

import { RequirePermission } from '@/components/shell/RouteGuard';
import { PageHeader } from '@/components/ui/states';
import { t } from '@/i18n';
import { useSession } from '@/lib/auth/session';
import { AutoActionRules } from './AutoActionRules';
import { ModerationTabs } from './ModerationTabs';
import { SafetySettingsSection } from './SafetySettingsSection';

/** Auto-action risk thresholds (moderation rules) plus the safety system settings (settings.manage). */
export function ThresholdsPage() {
  const { admin } = useSession();
  return (
    <RequirePermission permission="moderation.rules.manage" permissions={admin?.permissions ?? []}>
      <PageHeader title={t('safety.thresholds.title')} intro={t('safety.thresholds.intro')} />
      <ModerationTabs />
      <section className="card" aria-labelledby="risk-model">
        <h2 id="risk-model" className="card__title">{t('safety.thresholds.riskModelTitle')}</h2>
        <p>{t('safety.thresholds.riskModel')}</p>
        <p className="muted">{t('safety.thresholds.riskModelFixed')}</p>
      </section>
      <AutoActionRules />
      <SafetySettingsSection />
    </RequirePermission>
  );
}
