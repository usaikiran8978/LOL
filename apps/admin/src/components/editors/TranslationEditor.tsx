'use client';

import { locale as localeSchema } from '@amora/shared';
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { t, type MessageKey } from '@/i18n';
import type { FieldErrors } from '@/lib/forms/validate';
import { Button } from '../ui/Button';
import { TextAreaField, TextField } from '../ui/fields';
import { MarkdownEditor } from './MarkdownEditor';

export interface TranslationFieldSpec<F extends string> {
  name: F;
  labelKey: MessageKey;
  kind?: 'text' | 'textarea' | 'markdown';
  optional?: boolean;
  maxLength?: number;
}

export type TranslationValues<F extends string> = Record<string, Record<F, string>>;

export function emptyTranslation<F extends string>(fields: readonly TranslationFieldSpec<F>[]): Record<F, string> {
  return Object.fromEntries(fields.map((f) => [f.name, ''])) as Record<F, string>;
}

/** Server rows (nullable/partial per locale) → editor state with every field present. */
export function translationsFromServer<F extends string>(
  fields: readonly TranslationFieldSpec<F>[],
  server: Record<string, Partial<Record<F, string | null>>> | undefined,
): TranslationValues<F> {
  const out: TranslationValues<F> = {};
  for (const [loc, values] of Object.entries(server ?? {})) {
    out[loc] = Object.fromEntries(fields.map((f) => [f.name, values[f.name] ?? ''])) as Record<F, string>;
  }
  if (!out.en) out.en = emptyTranslation(fields);
  return out;
}

/** Editor state → contract payload: optional fields left blank are omitted rather than sent as "". */
export function translationsToPayload<F extends string>(fields: readonly TranslationFieldSpec<F>[], value: TranslationValues<F>) {
  const out: Record<string, Partial<Record<F, string>>> = {};
  for (const [loc, values] of Object.entries(value)) {
    const entry: Partial<Record<F, string>> = {};
    for (const f of fields) {
      const v = values[f.name] ?? '';
      if (v.trim() === '' && f.optional) continue;
      entry[f.name] = v;
    }
    out[loc] = entry;
  }
  return out;
}

interface Props<F extends string> {
  fields: readonly TranslationFieldSpec<F>[];
  value: TranslationValues<F>;
  onChange: (value: TranslationValues<F>) => void;
  /** Errors relative to the translations object: '' = whole object (e.g. missing en), 'fr.label' = one field. */
  errors?: FieldErrors;
}

/** Multi-locale editor. English is always first and cannot be removed (contracts require an `en` entry). */
export function TranslationEditor<F extends string>({ fields, value, onChange, errors = {} }: Props<F>) {
  const baseId = useId();
  const locales = Object.keys(value).sort((a, b) => (a === 'en' ? -1 : b === 'en' ? 1 : a.localeCompare(b)));
  const [active, setActive] = useState<string>(locales[0] ?? 'en');
  const [newLocale, setNewLocale] = useState('');
  const [localeError, setLocaleError] = useState<string | undefined>();
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const current = locales.includes(active) ? active : (locales[0] ?? 'en');
  const missingEn = !('en' in value);

  function addLocale() {
    const code = newLocale.trim();
    if (!localeSchema.safeParse(code).success) return setLocaleError(t('translations.localeInvalid'));
    if (code in value) return setLocaleError(t('translations.localeExists'));
    setLocaleError(undefined);
    setNewLocale('');
    onChange({ ...value, [code]: emptyTranslation(fields) });
    setActive(code);
  }

  function removeLocale(code: string) {
    if (code === 'en') return;
    const next = { ...value };
    delete next[code];
    onChange(next);
    setActive('en');
  }

  function onTabKey(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = locales[(index + delta + locales.length) % locales.length]!;
    setActive(next);
    tabRefs.current[next]?.focus();
  }

  const localeHasError = (loc: string) => Object.keys(errors).some((k) => k.startsWith(`${loc}.`));

  return (
    <fieldset className="translations">
      <legend>{t('translations.legend')}</legend>
      {missingEn || errors[''] ? <p className="field__error" role="alert">{t('translations.missingEn')}</p> : null}
      <div role="tablist" aria-label={t('translations.tabsLabel')} className="tabs">
        {locales.map((loc, i) => (
          <button
            key={loc}
            ref={(el) => { tabRefs.current[loc] = el; }}
            type="button"
            role="tab"
            id={`${baseId}-tab-${loc}`}
            aria-selected={loc === current}
            aria-controls={`${baseId}-panel`}
            tabIndex={loc === current ? 0 : -1}
            className={`tab${localeHasError(loc) ? ' tab--error' : ''}`}
            onClick={() => setActive(loc)}
            onKeyDown={(e) => onTabKey(e, i)}
          >
            {loc}
            {loc === 'en' ? <span aria-hidden="true"> *</span> : null}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${baseId}-panel`} aria-labelledby={`${baseId}-tab-${current}`} className="tabpanel">
        {value[current]
          ? fields.map((f) => {
              const v = value[current]![f.name] ?? '';
              const set = (nv: string) => onChange({ ...value, [current]: { ...value[current]!, [f.name]: nv } });
              const label = `${t(f.labelKey)} (${current})`;
              const error = errors[`${current}.${f.name}`];
              if (f.kind === 'markdown') return <MarkdownEditor key={f.name} label={label} value={v} onChange={set} error={error} required={!f.optional} />;
              if (f.kind === 'textarea') return <TextAreaField key={f.name} label={label} value={v} onChange={set} error={error} required={!f.optional} maxLength={f.maxLength} rows={3} />;
              return <TextField key={f.name} label={label} value={v} onChange={set} error={error} required={!f.optional} maxLength={f.maxLength} dir="auto" />;
            })
          : null}
        {current === 'en' ? (
          <p className="field__hint">{t('translations.enLocked')}</p>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => removeLocale(current)}>{t('translations.removeLocale', { locale: current })}</Button>
        )}
      </div>
      <div className="row row--end">
        <TextField
          label={t('translations.addLocaleLabel')}
          value={newLocale}
          onChange={setNewLocale}
          error={localeError}
          className="field--inline"
          // Enter would otherwise submit the surrounding dialog form.
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLocale(); } }}
        />
        <Button variant="secondary" size="sm" onClick={addLocale}>{t('translations.addLocale')}</Button>
      </div>
    </fieldset>
  );
}
