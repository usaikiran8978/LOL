'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { t } from '@/i18n';
import { TextAreaField } from '../ui/fields';

/** Markdown preview. react-markdown never renders raw HTML, so admin content cannot inject markup here. */
export function MarkdownPreview({ source }: { source: string }) {
  if (!source.trim()) return <p className="muted">{t('markdown.emptyPreview')}</p>;
  return (
    <div className="markdown" dir="auto">
      <ReactMarkdown>{source}</ReactMarkdown>
    </div>
  );
}

export function MarkdownEditor({ label, value, onChange, error, required, rows = 12 }: {
  label: string; value: string; onChange: (value: string) => void; error?: string; required?: boolean; rows?: number;
}) {
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  return (
    <div className="markdown-editor">
      <div className="row row--between">
        <span className="field__label" aria-hidden="true">{label}</span>
        <div role="group" aria-label={t('markdown.modeLabel', { label })} className="segmented">
          <button type="button" aria-pressed={mode === 'write'} onClick={() => setMode('write')}>{t('markdown.write')}</button>
          <button type="button" aria-pressed={mode === 'preview'} onClick={() => setMode('preview')}>{t('markdown.preview')}</button>
        </div>
      </div>
      {mode === 'write' ? (
        <TextAreaField label={label} hint={t('markdown.hint')} value={value} onChange={onChange} error={error} required={required} rows={rows} className="field--bare-label" dir="auto" />
      ) : (
        <div className="markdown-editor__preview" aria-label={`${label} — ${t('markdown.preview')}`} role="region">
          <MarkdownPreview source={value} />
          {error ? <p className="field__error" role="alert">{error}</p> : null}
        </div>
      )}
    </div>
  );
}
