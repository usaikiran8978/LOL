'use client';

import { adminPreviewRequest } from '@amora/shared';
import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DefinitionList } from '@/components/ui/DefinitionList';
import { TextAreaField, TextField } from '@/components/ui/fields';
import { FormError } from '@/components/ui/states';
import { t } from '@/i18n';
import { errorMessage, requestIdOf } from '@/lib/api/errors';
import type { PreviewResult } from '@/lib/api/modules/questionnaire';
import { useAdminApi } from '@/lib/auth/session';
import { useFormSubmit } from '@/lib/forms/useFormSubmit';
import { parseJsonText } from '@/lib/forms/validate';
import { formatNumber } from '@/lib/format';
import { answerTypeLabel, IssuesList } from './shared';

/** Renders a version as a user in `locale` would see it, and checks targeting against sample user facts. */
export function PreviewPanel({ versionId }: { versionId: string }) {
  const api = useAdminApi();
  const { busy, error, fieldErrors, setFieldErrors, submit } = useFormSubmit();
  const [locale, setLocale] = useState('en');
  const [facts, setFacts] = useState('');
  const [result, setResult] = useState<PreviewResult | null>(null);

  async function run() {
    let parsed: unknown = {};
    if (facts.trim()) {
      const p = parseJsonText(facts);
      if (!p.ok) return setFieldErrors({ facts: t('validation.invalidJson') });
      if (!p.value || typeof p.value !== 'object' || Array.isArray(p.value)) return setFieldErrors({ facts: t('validation.jsonObject') });
      parsed = p.value;
    }
    await submit(adminPreviewRequest, { locale: locale.trim(), facts: parsed }, async (body) => setResult(await api.questionnaire.preview(versionId, body)));
  }

  return (
    <div className="stack">
      <div className="grid grid--2">
        <TextField label={t('questionnaire.preview.locale')} hint={t('questionnaire.preview.localeHint')} value={locale} onChange={setLocale} error={fieldErrors.locale} spellCheck={false} />
        <TextAreaField label={t('questionnaire.preview.facts')} hint={t('questionnaire.preview.factsHint')} value={facts} onChange={setFacts} error={fieldErrors.facts} rows={3} spellCheck={false} className="code-input" />
      </div>
      <div className="row">
        <Button variant="secondary" onClick={() => void run()} disabled={busy}>{busy ? t('app.loading') : t('questionnaire.preview.run')}</Button>
      </div>
      {error ? <FormError message={errorMessage(error)} requestId={requestIdOf(error)} /> : null}
      {result ? <RenderedPreview result={result} /> : null}
    </div>
  );
}

function RenderedPreview({ result }: { result: PreviewResult }) {
  const r = result.rendered;
  const c = r.constraints;
  const range = (a: number | null, b: number | null) => (a === null && b === null ? null : `${formatNumber(a)} – ${formatNumber(b)}`);
  return (
    <section className="stack" aria-label={t('questionnaire.preview.result')}>
      <p>
        {result.targetingMatches ? <Badge tone="success">{t('questionnaire.preview.targetingMatch')}</Badge> : <Badge tone="warning">{t('questionnaire.preview.targetingNoMatch')}</Badge>}
        {result.conditions.length ? <> <Badge tone="info">{t('questionnaire.preview.conditional', { count: result.conditions.length })}</Badge></> : null}
      </p>
      <div className="card">
        <p dir="auto"><strong>{r.text || t('questionnaire.preview.noText')}</strong>{r.isRequired ? <span aria-hidden="true"> *</span> : null}</p>
        {r.helpText ? <p className="muted" dir="auto">{r.helpText}</p> : null}
        {r.options.length ? (
          <ul>
            {r.options.map((o) => (
              <li key={o.key} dir="auto">{o.label} <code>{o.key}</code>{o.isExclusive ? <> <Badge>{t('questionnaire.options.exclusive')}</Badge></> : null}</li>
            ))}
          </ul>
        ) : null}
        {r.answerType === 'scale' ? <p dir="auto">{r.scaleMinLabel ?? formatNumber(c.scaleMin)} ⟷ {r.scaleMaxLabel ?? formatNumber(c.scaleMax)}</p> : null}
      </div>
      <DefinitionList
        items={[
          { label: t('questionnaire.editor.answerType'), value: answerTypeLabel(r.answerType) },
          { label: t('questionnaire.editor.isRequired'), value: r.isRequired ? t('common.yes') : t('common.no') },
          { label: t('questionnaire.preview.skippable'), value: r.allowSkip ? t('common.yes') : t('common.no') },
          { label: t('questionnaire.editor.allowImportance'), value: r.allowImportance ? t('common.yes') : t('common.no') },
          { label: t('questionnaire.editor.allowDealbreaker'), value: r.allowDealbreaker ? t('common.yes') : t('common.no') },
          range(c.minSelections, c.maxSelections) ? { label: t('questionnaire.preview.selections'), value: range(c.minSelections, c.maxSelections) } : null,
          range(c.scaleMin, c.scaleMax) ? { label: t('questionnaire.preview.scale'), value: `${range(c.scaleMin, c.scaleMax)}${c.scaleStep ? ` (${t('questionnaire.editor.scaleStep')} ${formatNumber(c.scaleStep)})` : ''}` } : null,
          range(c.numericMin, c.numericMax) ? { label: t('questionnaire.preview.numeric'), value: range(c.numericMin, c.numericMax) } : null,
          c.textMaxLength !== null ? { label: t('questionnaire.editor.textMaxLength'), value: formatNumber(c.textMaxLength) } : null,
        ]}
      />
      <IssuesList issues={result.issues} title={t('questionnaire.workflow.issuesTitle')} />
    </section>
  );
}
