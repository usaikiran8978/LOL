'use client';

import type { AnswerType } from '@amora/shared';
import { TranslationEditor } from '@/components/editors/TranslationEditor';
import { Button } from '@/components/ui/Button';
import { CheckboxField, NumberField, TextField } from '@/components/ui/fields';
import { t } from '@/i18n';
import { scopedErrors, type FieldErrors } from '@/lib/forms/validate';
import { newOption, OPTION_LABEL_FIELDS, type OptionForm } from './draft';

interface Props {
  answerType: AnswerType;
  options: OptionForm[];
  onChange: (options: OptionForm[]) => void;
  /** Errors relative to `options` (e.g. '0.key', '' for the array). */
  errors: FieldErrors;
  disabled?: boolean;
}

/** Answer options: key, score value, exclusivity and localized labels; ordered as shown to users. */
export function OptionsEditor({ answerType, options, onChange, errors, disabled }: Props) {
  const set = (i: number, patch: Partial<OptionForm>) => onChange(options.map((o, n) => (n === i ? { ...o, ...patch } : o)));
  const move = (i: number, delta: number) => {
    const next = [...options];
    const [item] = next.splice(i, 1);
    next.splice(i + delta, 0, item!);
    onChange(next);
  };
  const name = (o: OptionForm, i: number) => o.key || t('questionnaire.options.optionN', { n: i + 1 });

  return (
    <fieldset className="stack">
      <legend>{t('questionnaire.options.title')}</legend>
      <p className="field__hint">{answerType === 'yes_no' ? t('questionnaire.options.yesNoHint') : t('questionnaire.options.hint')}</p>
      {errors[''] ? <p className="field__error" role="alert">{errors['']}</p> : null}
      {answerType === 'yes_no' && !(options.length === 2 && options.some((o) => o.key === 'yes') && options.some((o) => o.key === 'no')) ? (
        <Button variant="secondary" size="sm" disabled={disabled} onClick={() => onChange([newOption('yes', t('common.yes')), newOption('no', t('common.no'))])}>
          {t('questionnaire.options.useYesNo')}
        </Button>
      ) : null}
      {options.length === 0 ? <p className="muted">{t('questionnaire.options.empty')}</p> : null}
      <ol className="rules__list">
        {options.map((o, i) => {
          const e = scopedErrors(errors, String(i));
          return (
            <li key={o.uid} className="rule" aria-label={name(o, i)}>
              <div className="grid grid--3">
                <TextField label={t('questionnaire.options.key')} hint={t('questionnaire.options.keyHint')} value={o.key} onChange={(key) => set(i, { key })} error={e.key} required spellCheck={false} disabled={disabled} />
                <NumberField label={t('questionnaire.options.numericValue')} hint={t('questionnaire.options.numericValueHint')} value={o.numericValue} onChange={(numericValue) => set(i, { numericValue })} error={e.numericValue} step="any" disabled={disabled} />
                <CheckboxField label={t('questionnaire.options.exclusive')} hint={t('questionnaire.options.exclusiveHint')} checked={o.isExclusive} onChange={(isExclusive) => set(i, { isExclusive })} disabled={disabled} />
              </div>
              <TranslationEditor fields={OPTION_LABEL_FIELDS} value={o.translations} onChange={(translations) => set(i, { translations })} errors={scopedErrors(e, 'translations')} />
              <div className="row">
                <Button variant="ghost" size="sm" disabled={disabled || i === 0} onClick={() => move(i, -1)} aria-label={`${t('common.moveUp')} — ${name(o, i)}`}>{t('common.moveUp')}</Button>
                <Button variant="ghost" size="sm" disabled={disabled || i === options.length - 1} onClick={() => move(i, 1)} aria-label={`${t('common.moveDown')} — ${name(o, i)}`}>{t('common.moveDown')}</Button>
                <Button variant="ghost" size="sm" disabled={disabled} onClick={() => onChange(options.filter((_, n) => n !== i))} aria-label={`${t('common.remove')} — ${name(o, i)}`}>{t('common.remove')}</Button>
              </div>
            </li>
          );
        })}
      </ol>
      <Button variant="secondary" size="sm" disabled={disabled || options.length >= 60} onClick={() => onChange([...options, newOption()])}>{t('questionnaire.options.add')}</Button>
    </fieldset>
  );
}
