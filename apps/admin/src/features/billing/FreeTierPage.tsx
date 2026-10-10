'use client';

import { ENTITLEMENT_KEYS } from '@amora/shared';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui/states';
import { t } from '@/i18n';
import type { FreeTierRow } from '@/lib/api/modules/billing';
import { useAdminApi, useSession } from '@/lib/auth/session';
import { useResource } from '@/lib/hooks/useResource';
import { BillingSection } from './BillingSection';
import { FreeTierDialog } from './FreeTierDialog';
import { entitlementLabel, limitLabel, overridesOf, periodLabel } from './labels';

export function FreeTierPage() {
  return (
    <BillingSection permission="billing.view">
      <FreeTierView />
    </BillingSection>
  );
}

function overridesText(row: FreeTierRow): string {
  const entries = Object.entries(overridesOf(row.country_overrides));
  if (entries.length === 0) return '—';
  return entries.map(([country, limit]) => `${country}: ${limitLabel(limit)}`).join(', ');
}

function FreeTierView() {
  const api = useAdminApi();
  const canManage = useSession().can('billing.plans.manage');
  const data = useResource(() => api.billing.freeTier(), [api]);
  const [editing, setEditing] = useState<FreeTierRow | 'new' | null>(null);
  const configured = new Set(data.status === 'success' ? data.data.map((r) => r.entitlement_key) : []);
  const available = ENTITLEMENT_KEYS.filter((k) => !configured.has(k));

  return (
    <>
      <PageHeader
        title={t('billing.freeTier.title')}
        intro={t('billing.freeTier.intro')}
        actions={canManage && data.status === 'success' ? (
          <Button onClick={() => setEditing('new')} disabled={available.length === 0} title={available.length === 0 ? t('billing.freeTier.allConfigured') : undefined}>
            {t('billing.freeTier.newLimit')}
          </Button>
        ) : null}
      />
      {data.status === 'loading' ? <LoadingState /> : null}
      {data.status === 'error' ? <ErrorState error={data.error} onRetry={data.reload} /> : null}
      {data.status === 'success' && data.data.length === 0 ? <EmptyState message={t('billing.freeTier.empty')} /> : null}
      {data.status === 'success' && data.data.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('billing.freeTier.entitlement')}</th>
                <th scope="col" className="num">{t('billing.freeTier.limit')}</th>
                <th scope="col">{t('billing.freeTier.period')}</th>
                <th scope="col">{t('billing.freeTier.overrides')}</th>
                <th scope="col"><span className="visually-hidden">{t('common.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((r) => (
                <tr key={r.entitlement_key}>
                  <td>{entitlementLabel(r.entitlement_key)} <code>{r.entitlement_key}</code></td>
                  <td className="num">{limitLabel(r.limit_value)}</td>
                  <td>{periodLabel(r.limit_period)}</td>
                  <td>{overridesText(r)}</td>
                  <td className="table__actions">
                    {canManage ? (
                      <Button variant="ghost" size="sm" onClick={() => setEditing(r)} aria-label={`${t('common.edit')} ${r.entitlement_key}`}>{t('common.edit')}</Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {editing ? <FreeTierDialog row={editing === 'new' ? null : editing} availableKeys={available} onClose={() => setEditing(null)} onSaved={data.reload} /> : null}
    </>
  );
}
