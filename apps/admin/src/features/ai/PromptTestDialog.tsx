'use client';

import { adminAiTestRun } from '@amora/shared';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { DefinitionList } from '@/components/ui/DefinitionList';
import { Dialog } from '@/components/ui/Dialog';
import { SelectField, TextAreaField } from '@/components/ui/fields';
import { BoolBadge, FormError } from '@/components/ui/states';
import { t, type MessageKey } from '@/i18n';
import { ApiError } from '@/lib/api/client';
import { errorMessage, requestIdOf } from '@/lib/api/errors';
import type { AiPromptTemplate, AiPromptVersion, AiTestRunResult } from '@/lib/api/modules/ai';
import { useAdminApi } from '@/lib/auth/session';
import { useFormSubmit } from '@/lib/forms/useFormSubmit';
import { modelLabel, type ModelRef } from './shared';

const HINTS: Partial<Record<string, MessageKey>> = {
  AI_NOT_CONFIGURED: 'ai.test.notConfiguredHint',
  AI_UNAVAILABLE: 'ai.test.unavailableHint',
  AI_BUDGET_EXCEEDED: 'ai.test.budgetHint',
  AI_INPUT_BLOCKED: 'ai.test.inputBlockedHint',
};

function errorHint(error: unknown): string | null {
  const key = error instanceof ApiError ? HINTS[error.code] : undefined;
  return key ? t(key) : null;
}

/** Test-runs a prompt version on sample variables (POST admin/ai/prompts/versions/:id/test). */
export function PromptTestDialog({ template, version, models, onClose }: {
  template: AiPromptTemplate; version: AiPromptVersion; models: ModelRef[]; onClose: () => void;
}) {
  const api = useAdminApi();
  const { busy, error, fieldErrors, submit } = useFormSubmit();
  const [variables, setVariables] = useState<Record<string, string>>(() => Object.fromEntries(version.input_variables.map((v) => [v, ''])));
  const [modelId, setModelId] = useState('');
  const [result, setResult] = useState<AiTestRunResult | null>(null);
  const hint = errorHint(error);

  async function run() {
    setResult(null);
    await submit(adminAiTestRun, { variables, modelId: modelId || undefined }, async (body) => {
      setResult(await api.ai.testPromptVersion(version.id, body));
    });
  }

  return (
    <Dialog
      title={t('ai.test.title', { key: template.key, version: version.version })}
      onClose={onClose}
      onSubmit={() => void run()}
      busy={busy}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>{t('common.close')}</Button>
          <Button type="submit" disabled={busy}>{busy ? t('ai.test.running') : t('ai.test.run')}</Button>
        </>
      }
    >
      <p className="muted">{t('ai.test.intro')}</p>
      {error ? <FormError message={errorMessage(error)} requestId={requestIdOf(error)} /> : null}
      {hint ? <p className="muted">{hint}</p> : null}
      <SelectField
        label={t('ai.test.model')}
        value={modelId}
        onChange={setModelId}
        placeholder={t('ai.test.modelDefault')}
        options={models.filter((m) => m.model.purpose === 'chat' || m.model.id === modelId).map((m) => ({ value: m.model.id, label: modelLabel(m) }))}
        error={fieldErrors.modelId}
      />
      {version.input_variables.length === 0 ? <p className="muted">{t('ai.test.noVariables')}</p> : null}
      {version.input_variables.map((name) => (
        <TextAreaField
          key={name}
          label={t('ai.test.variableLabel', { name })}
          value={variables[name] ?? ''}
          onChange={(v) => setVariables((s) => ({ ...s, [name]: v }))}
          error={fieldErrors[`variables.${name}`]}
          rows={2}
          maxLength={20000}
        />
      ))}
      {result ? (
        <section aria-labelledby="ai-test-result" aria-live="polite">
          <h3 id="ai-test-result" className="card__title">{t('ai.test.result')}</h3>
          <DefinitionList
            items={[
              { label: t('ai.test.resultModel'), value: <code>{result.model}</code> },
              { label: t('ai.test.usedFallback'), value: <BoolBadge value={result.usedFallback} /> },
              { label: t('ai.test.requestId'), value: <code>{result.requestId}</code> },
            ]}
          />
          <h4 className="card__title">{t('ai.test.output')}</h4>
          <pre className="code pre-wrap"><code>{JSON.stringify(result.output, null, 2)}</code></pre>
          <p className="muted">{t('ai.test.metricsNote')}</p>
        </section>
      ) : null}
    </Dialog>
  );
}
