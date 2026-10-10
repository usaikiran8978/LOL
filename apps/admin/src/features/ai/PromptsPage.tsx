'use client';

import { useState } from 'react';
import { useNotify } from '@/components/shell/notice';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge } from '@/components/ui/states';
import { t } from '@/i18n';
import type { AiPromptTemplate, AiPromptVersion } from '@/lib/api/modules/ai';
import { useAdminApi, useSession } from '@/lib/auth/session';
import { formatDateTime } from '@/lib/format';
import { useResource } from '@/lib/hooks/useResource';
import { PromptTestDialog } from './PromptTestDialog';
import { PromptVersionDialog } from './PromptVersionDialog';
import { PromptVersionView } from './PromptVersionView';
import { AiTabs, allModels, featureName } from './shared';

type Target = { template: AiPromptTemplate; version: AiPromptVersion };

export function PromptsPage() {
  const api = useAdminApi();
  const notify = useNotify();
  const { can } = useSession();
  const canEdit = can('ai.prompts.edit');
  const canPublish = can('ai.prompts.publish');
  const data = useResource(async () => {
    const [prompts, providers] = await Promise.all([api.ai.prompts(), api.ai.providers()]);
    return { prompts, models: allModels(providers) };
  }, [api]);
  const [drafting, setDrafting] = useState<AiPromptTemplate | null>(null);
  const [viewing, setViewing] = useState<Target | null>(null);
  const [testing, setTesting] = useState<Target | null>(null);
  const [publishing, setPublishing] = useState<Target | null>(null);

  async function publish({ version }: Target) {
    await api.ai.publishPromptVersion(version.id);
    notify(t('ai.prompts.published_ok', { version: version.version }));
    data.reload();
  }

  return (
    <>
      <PageHeader title={t('ai.prompts.title')} intro={t('ai.prompts.intro')} />
      <AiTabs />
      {data.status === 'loading' ? <LoadingState /> : null}
      {data.status === 'error' ? <ErrorState error={data.error} onRetry={data.reload} /> : null}
      {data.status === 'success' && data.data.prompts.length === 0 ? <EmptyState message={t('ai.prompts.empty')} /> : null}
      {data.status === 'success'
        ? data.data.prompts.map((tpl) => (
          <TemplateCard
            key={tpl.id}
            template={tpl}
            canEdit={canEdit}
            canPublish={canPublish}
            onDraft={() => setDrafting(tpl)}
            onView={(version) => setViewing({ template: tpl, version })}
            onTest={(version) => setTesting({ template: tpl, version })}
            onPublish={(version) => setPublishing({ template: tpl, version })}
          />
        ))
        : null}
      {drafting ? <PromptVersionDialog template={drafting} onClose={() => setDrafting(null)} onSaved={data.reload} /> : null}
      {viewing ? <PromptVersionView template={viewing.template} version={viewing.version} onClose={() => setViewing(null)} /> : null}
      {testing && data.status === 'success' ? (
        <PromptTestDialog template={testing.template} version={testing.version} models={data.data.models} onClose={() => setTesting(null)} />
      ) : null}
      {publishing ? (
        <ConfirmDialog
          title={t('ai.prompts.confirmPublishTitle', { key: publishing.template.key, version: publishing.version.version })}
          body={t('ai.prompts.confirmPublishBody')}
          confirmLabel={t('ai.prompts.confirmPublishAction')}
          onConfirm={() => publish(publishing)}
          onClose={() => setPublishing(null)}
        />
      ) : null}
    </>
  );
}

function TemplateCard({ template, canEdit, canPublish, onDraft, onView, onTest, onPublish }: {
  template: AiPromptTemplate; canEdit: boolean; canPublish: boolean; onDraft: () => void;
  onView: (v: AiPromptVersion) => void; onTest: (v: AiPromptVersion) => void; onPublish: (v: AiPromptVersion) => void;
}) {
  const titleId = `ai-prompt-${template.id}`;
  return (
    <section className="card" aria-labelledby={titleId}>
      <div className="toolbar">
        <div>
          <h2 id={titleId} className="card__title"><code>{template.key}</code></h2>
          <p className="muted">{t('ai.prompts.feature', { feature: featureName(template.feature_key) })}</p>
          {template.description ? <p>{template.description}</p> : null}
        </div>
        {canEdit ? (
          <div className="toolbar__end">
            <Button size="sm" onClick={onDraft} aria-label={t('ai.prompts.newVersionFor', { key: template.key })}>{t('ai.prompts.newVersion')}</Button>
          </div>
        ) : null}
      </div>
      {template.versions.length === 0 ? (
        <p className="muted">{t('ai.prompts.noVersions')}</p>
      ) : (
        <div className="table-wrap">
          <table className="table table--compact">
            <thead>
              <tr>
                <th scope="col">{t('ai.prompts.version')}</th>
                <th scope="col">{t('common.status')}</th>
                <th scope="col">{t('ai.prompts.variables')}</th>
                <th scope="col">{t('ai.prompts.changeNote')}</th>
                <th scope="col">{t('ai.prompts.created')}</th>
                <th scope="col">{t('ai.prompts.publishedAt')}</th>
                <th scope="col"><span className="visually-hidden">{t('common.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {template.versions.map((v) => {
                const label = `${template.key} ${t('ai.prompts.versionLabel', { version: v.version })}`;
                return (
                  <tr key={v.id}>
                    <td>{t('ai.prompts.versionLabel', { version: v.version })}</td>
                    <td><StatusBadge status={v.status} /></td>
                    <td>{v.input_variables.length ? <code>{v.input_variables.join(', ')}</code> : '—'}</td>
                    <td>{v.change_note ?? '—'}</td>
                    <td>{formatDateTime(v.created_at)}</td>
                    <td>{formatDateTime(v.published_at)}</td>
                    <td className="table__actions">
                      <Button variant="ghost" size="sm" onClick={() => onView(v)} aria-label={`${t('ai.prompts.view')} ${label}`}>{t('ai.prompts.view')}</Button>
                      {canEdit ? <Button variant="ghost" size="sm" onClick={() => onTest(v)} aria-label={`${t('ai.prompts.test')} ${label}`}>{t('ai.prompts.test')}</Button> : null}
                      {canPublish && v.status === 'draft' ? (
                        <Button variant="secondary" size="sm" onClick={() => onPublish(v)} aria-label={`${t('ai.prompts.publish')} ${label}`}>{t('ai.prompts.publish')}</Button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
