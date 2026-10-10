'use client';

import { adminMatchingConfigInput, type AdminMatchingConfigInput } from '@amora/shared';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { TextAreaField } from '@/components/ui/fields';
import { t } from '@/i18n';
import { parseJsonText, validate, type FieldErrors } from '@/lib/forms/validate';

/**
 * Raw JSON view of the config payload. Read-only versions just show it; drafts can paste JSON, which is validated
 * with the shared contract before it replaces the form state.
 */
export function AdvancedJson({ initial, editable, onApply }: { initial: unknown; editable: boolean; onApply: (input: AdminMatchingConfigInput) => void }) {
  const [text, setText] = useState(() => JSON.stringify(initial, null, 2));
  const [error, setError] = useState<string | undefined>();
  const [issues, setIssues] = useState<FieldErrors>({});

  if (!editable) {
    return (
      <section className="card" aria-labelledby="matching-json">
        <h2 id="matching-json" className="card__title">{t('matching.editor.json.title')}</h2>
        <pre className="code">{text}</pre>
      </section>
    );
  }

  function apply() {
    const parsed = parseJsonText(text);
    if (!parsed.ok) {
      setIssues({});
      return setError(t('validation.invalidJson'));
    }
    const v = validate(adminMatchingConfigInput, parsed.value);
    if (!v.ok) {
      setIssues(v.errors);
      return setError(t('validation.formHasErrors', { count: Object.keys(v.errors).length }));
    }
    setError(undefined);
    setIssues({});
    onApply(v.data);
  }

  return (
    <section className="card" aria-labelledby="matching-json">
      <h2 id="matching-json" className="card__title">{t('matching.editor.json.title')}</h2>
      <p className="field__hint">{t('matching.editor.json.hint')}</p>
      <TextAreaField label={t('json.label')} value={text} onChange={setText} rows={24} error={error} spellCheck={false} className="code-input" />
      {Object.keys(issues).length > 0 ? (
        <ul className="issues issues--error">
          {Object.entries(issues).map(([path, msg]) => <li key={path}><code>{path || '(root)'}</code> — {msg}</li>)}
        </ul>
      ) : null}
      <Button variant="secondary" onClick={apply}>{t('matching.editor.json.apply')}</Button>
    </section>
  );
}
