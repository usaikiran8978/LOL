'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { BoolBadge, EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui/states';
import { t } from '@/i18n';
import type { AiModel, AiProvider } from '@/lib/api/modules/ai';
import { useAdminApi, useSession } from '@/lib/auth/session';
import { formatNumber } from '@/lib/format';
import { useResource } from '@/lib/hooks/useResource';
import { ModelDialog } from './ModelDialog';
import { ProviderDialog } from './ProviderDialog';
import { AiTabs, allModels, formatInt, formatUsd, kindLabel, purposeLabel } from './shared';

type ModelEdit = { provider: AiProvider; model: AiModel | null };

export function ProvidersPage() {
  const api = useAdminApi();
  const canManage = useSession().can('ai.manage');
  const data = useResource(() => api.ai.providers(), [api]);
  const [editing, setEditing] = useState<AiProvider | 'new' | null>(null);
  const [modelEdit, setModelEdit] = useState<ModelEdit | null>(null);

  return (
    <>
      <PageHeader
        title={t('ai.providers.title')}
        intro={t('ai.providers.intro')}
        actions={canManage ? <Button onClick={() => setEditing('new')}>{t('ai.providers.newProvider')}</Button> : undefined}
      />
      <AiTabs />
      {data.status === 'loading' ? <LoadingState /> : null}
      {data.status === 'error' ? <ErrorState error={data.error} onRetry={data.reload} /> : null}
      {data.status === 'success' && data.data.length === 0 ? <EmptyState message={t('ai.providers.empty')} /> : null}
      {data.status === 'success' && data.data.length > 0 ? (
        <>
          <ProvidersTable providers={data.data} canManage={canManage} onEdit={setEditing} onAddModel={(p) => setModelEdit({ provider: p, model: null })} />
          <ModelsTable providers={data.data} canManage={canManage} onEdit={setModelEdit} />
        </>
      ) : null}
      {editing ? <ProviderDialog provider={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={data.reload} /> : null}
      {modelEdit ? <ModelDialog provider={modelEdit.provider} model={modelEdit.model} onClose={() => setModelEdit(null)} onSaved={data.reload} /> : null}
    </>
  );
}

function SecretBadge({ present }: { present: boolean }) {
  return present ? <Badge tone="success">{t('ai.providers.secretPresent')}</Badge> : <Badge tone="danger">{t('ai.providers.secretMissing')}</Badge>;
}

function ProvidersTable({ providers, canManage, onEdit, onAddModel }: {
  providers: AiProvider[]; canManage: boolean; onEdit: (p: AiProvider) => void; onAddModel: (p: AiProvider) => void;
}) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">{t('ai.providers.key')}</th>
            <th scope="col">{t('ai.providers.kind')}</th>
            <th scope="col">{t('ai.providers.baseUrl')}</th>
            <th scope="col">{t('ai.providers.secretRef')}</th>
            <th scope="col">{t('ai.providers.secretStatus')}</th>
            <th scope="col">{t('ai.providers.isEnabled')}</th>
            <th scope="col" className="num">{t('ai.providers.timeoutMs')}</th>
            <th scope="col" className="num">{t('ai.providers.models')}</th>
            {canManage ? <th scope="col"><span className="visually-hidden">{t('common.actions')}</span></th> : null}
          </tr>
        </thead>
        <tbody>
          {providers.map((p) => (
            <tr key={p.id} className={p.is_enabled && !p.secretPresent ? 'is-warning' : undefined}>
              <td><code>{p.key}</code></td>
              <td>{kindLabel(p.kind)}</td>
              <td>{p.base_url ? <code>{p.base_url}</code> : '—'}</td>
              <td><code>{p.secret_ref}</code></td>
              <td><SecretBadge present={p.secretPresent} /></td>
              <td><BoolBadge value={p.is_enabled} on={t('ai.enabled')} off={t('ai.disabled')} /></td>
              <td className="num">{formatInt(p.timeout_ms)}</td>
              <td className="num">{formatInt(p.models.length)}</td>
              {canManage ? (
                <td className="table__actions">
                  <Button variant="ghost" size="sm" onClick={() => onEdit(p)} aria-label={`${t('common.edit')} ${p.key}`}>{t('common.edit')}</Button>
                  <Button variant="ghost" size="sm" onClick={() => onAddModel(p)} aria-label={`${t('ai.providers.addModel')} ${p.key}`}>{t('ai.providers.addModel')}</Button>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ModelsTable({ providers, canManage, onEdit }: { providers: AiProvider[]; canManage: boolean; onEdit: (e: ModelEdit) => void }) {
  const models = allModels(providers);
  return (
    <section className="section" aria-labelledby="ai-models-title">
      <h2 id="ai-models-title" className="card__title">{t('ai.models.title')}</h2>
      {models.length === 0 ? (
        <EmptyState message={t('ai.models.empty')} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('ai.models.provider')}</th>
                <th scope="col">{t('ai.models.modelName')}</th>
                <th scope="col">{t('ai.models.purpose')}</th>
                <th scope="col" className="num">{t('ai.models.contextTokens')}</th>
                <th scope="col" className="num">{t('ai.models.inputCost')}</th>
                <th scope="col" className="num">{t('ai.models.outputCost')}</th>
                <th scope="col">{t('ai.models.isEnabled')}</th>
                {canManage ? <th scope="col"><span className="visually-hidden">{t('common.actions')}</span></th> : null}
              </tr>
            </thead>
            <tbody>
              {models.map(({ model, provider }) => (
                <tr key={model.id}>
                  <td><code>{provider.key}</code></td>
                  <td><code>{model.model_name}</code></td>
                  <td>{purposeLabel(model.purpose)}</td>
                  <td className="num">{model.context_tokens === null ? '—' : formatNumber(model.context_tokens, 0)}</td>
                  <td className="num">{formatUsd(model.input_cost_per_mtok)}</td>
                  <td className="num">{formatUsd(model.output_cost_per_mtok)}</td>
                  <td><BoolBadge value={model.is_enabled} on={t('ai.enabled')} off={t('ai.disabled')} /></td>
                  {canManage ? (
                    <td className="table__actions">
                      <Button variant="ghost" size="sm" onClick={() => onEdit({ provider, model })} aria-label={`${t('common.edit')} ${provider.key} / ${model.model_name}`}>{t('common.edit')}</Button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
