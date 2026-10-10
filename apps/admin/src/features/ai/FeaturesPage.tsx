'use client';

import { AI_FEATURES, type AiFeature } from '@amora/shared';
import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { BoolBadge, ErrorState, LoadingState, PageHeader } from '@/components/ui/states';
import { t } from '@/i18n';
import type { AiFeatureConfig, AiPromptTemplate } from '@/lib/api/modules/ai';
import { useAdminApi, useSession } from '@/lib/auth/session';
import { useResource } from '@/lib/hooks/useResource';
import { FeatureDialog } from './FeatureDialog';
import { AiTabs, allModels, featureName, formatInt, formatUsd, modelLabel, type ModelRef } from './shared';

export function FeaturesPage() {
  const api = useAdminApi();
  const canManage = useSession().can('ai.manage');
  const data = useResource(async () => {
    const [features, providers, prompts] = await Promise.all([api.ai.features(), api.ai.providers(), api.ai.prompts()]);
    return { features, models: allModels(providers), prompts };
  }, [api]);
  const [editing, setEditing] = useState<AiFeature | null>(null);

  return (
    <>
      <PageHeader title={t('ai.features.title')} intro={t('ai.features.intro')} />
      <AiTabs />
      {data.status === 'loading' ? <LoadingState /> : null}
      {data.status === 'error' ? <ErrorState error={data.error} onRetry={data.reload} /> : null}
      {data.status === 'success' ? (
        <FeaturesTable features={data.data.features} models={data.data.models} prompts={data.data.prompts} canManage={canManage} onEdit={setEditing} />
      ) : null}
      {editing && data.status === 'success' ? (
        <FeatureDialog
          feature={editing}
          config={data.data.features.find((f) => f.feature_key === editing)}
          models={data.data.models}
          templates={data.data.prompts}
          onClose={() => setEditing(null)}
          onSaved={data.reload}
        />
      ) : null}
    </>
  );
}

function FeaturesTable({ features, models, prompts, canManage, onEdit }: {
  features: AiFeatureConfig[]; models: ModelRef[]; prompts: AiPromptTemplate[]; canManage: boolean; onEdit: (f: AiFeature) => void;
}) {
  const byKey = new Map(features.map((f) => [f.feature_key as string, f]));
  // Every known feature is listed; rows the API has not stored yet show as "not configured". Unknown stored keys are kept too.
  const keys = [...AI_FEATURES, ...features.map((f) => f.feature_key).filter((k) => !(AI_FEATURES as readonly string[]).includes(k))] as AiFeature[];
  const modelName = (id: string | null) => {
    if (!id) return '—';
    const ref = models.find((m) => m.model.id === id);
    return ref ? modelLabel(ref) : t('ai.features.unknownModel');
  };
  const limit = (n: number | null) => (n === null ? t('ai.features.unlimited') : formatInt(n));

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">{t('ai.features.feature')}</th>
            <th scope="col">{t('common.status')}</th>
            <th scope="col">{t('ai.features.primaryModel')}</th>
            <th scope="col">{t('ai.features.fallbackModel')}</th>
            <th scope="col">{t('ai.features.promptTemplate')}</th>
            <th scope="col">{t('ai.features.limits')}</th>
            <th scope="col" className="num">{t('ai.features.budget')}</th>
            <th scope="col">{t('ai.features.requiresEntitlement')}</th>
            {canManage ? <th scope="col"><span className="visually-hidden">{t('common.actions')}</span></th> : null}
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => {
            const cfg = byKey.get(key);
            const name = featureName(key);
            return (
              <tr key={key}>
                <th scope="row">
                  {name}
                  <br />
                  <code className="muted">{key}</code>
                </th>
                <td>{cfg ? <BoolBadge value={cfg.is_enabled} on={t('ai.enabled')} off={t('ai.disabled')} /> : <Badge tone="neutral">{t('ai.features.notConfigured')}</Badge>}</td>
                <td>{cfg ? modelName(cfg.primary_model_id) : '—'}</td>
                <td>{cfg ? modelName(cfg.fallback_model_id) : '—'}</td>
                <td>{cfg?.prompt_template_id ? <code>{prompts.find((p) => p.id === cfg.prompt_template_id)?.key ?? '—'}</code> : '—'}</td>
                <td>{cfg ? t('ai.features.limitsValue', { free: limit(cfg.per_user_daily_limit), premium: limit(cfg.premium_daily_limit) }) : '—'}</td>
                <td className="num">{cfg ? (cfg.monthly_budget_usd === null ? t('ai.features.noBudget') : formatUsd(cfg.monthly_budget_usd, 2)) : '—'}</td>
                <td>{cfg?.requires_entitlement ? <code>{cfg.requires_entitlement}</code> : '—'}</td>
                {canManage ? (
                  <td className="table__actions">
                    <Button variant="ghost" size="sm" onClick={() => onEdit(key)} aria-label={`${cfg ? t('common.edit') : t('ai.features.configure')} ${name}`}>
                      {cfg ? t('common.edit') : t('ai.features.configure')}
                    </Button>
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
