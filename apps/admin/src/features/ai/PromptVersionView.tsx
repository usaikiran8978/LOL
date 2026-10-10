'use client';

import { Button } from '@/components/ui/Button';
import { DefinitionList } from '@/components/ui/DefinitionList';
import { Dialog } from '@/components/ui/Dialog';
import { StatusBadge } from '@/components/ui/states';
import { t } from '@/i18n';
import type { AiPromptTemplate, AiPromptVersion } from '@/lib/api/modules/ai';
import { formatDateTime, formatNumber } from '@/lib/format';
import { toNumber } from './shared';

/** Read-only view of one prompt version (versions are immutable once created). */
export function PromptVersionView({ template, version, onClose }: { template: AiPromptTemplate; version: AiPromptVersion; onClose: () => void }) {
  const schema = typeof version.output_schema === 'string' ? version.output_schema : JSON.stringify(version.output_schema, null, 2);
  return (
    <Dialog
      title={t('ai.prompts.viewTitle', { key: template.key, version: version.version })}
      onClose={onClose}
      size="lg"
      footer={<Button variant="secondary" onClick={onClose}>{t('common.close')}</Button>}
    >
      <DefinitionList
        items={[
          { label: t('common.status'), value: <StatusBadge status={version.status} /> },
          { label: t('ai.prompts.created'), value: formatDateTime(version.created_at) },
          { label: t('ai.prompts.publishedAt'), value: formatDateTime(version.published_at) },
          { label: t('ai.prompts.temperature'), value: formatNumber(toNumber(version.temperature)) },
          { label: t('ai.prompts.maxOutputTokens'), value: formatNumber(version.max_output_tokens, 0) },
          { label: t('ai.prompts.variables'), value: version.input_variables.length ? <code>{version.input_variables.join(', ')}</code> : t('ai.prompts.none') },
          { label: t('ai.prompts.changeNote'), value: version.change_note ?? t('ai.prompts.none') },
        ]}
      />
      <h3 className="card__title">{t('ai.prompts.systemPrompt')}</h3>
      <pre className="code pre-wrap">{version.system_prompt}</pre>
      <h3 className="card__title">{t('ai.prompts.userTemplate')}</h3>
      <pre className="code pre-wrap">{version.user_template}</pre>
      <h3 className="card__title">{t('ai.prompts.outputSchema')}</h3>
      <pre className="code pre-wrap"><code>{schema}</code></pre>
    </Dialog>
  );
}
