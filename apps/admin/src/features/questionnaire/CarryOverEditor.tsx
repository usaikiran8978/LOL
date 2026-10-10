'use client';

import { Button } from '@/components/ui/Button';
import { SelectField } from '@/components/ui/fields';
import { t, tDynamic } from '@/i18n';
import type { CarryOver, QuestionVersion } from '@/lib/api/modules/questionnaire';
import { scopedErrors, type FieldErrors } from '@/lib/forms/validate';
import { CARRY_OVER, isChoice, newMapping, type MappingForm, type VersionForm } from './draft';

interface Props {
  form: Pick<VersionForm, 'answerType' | 'answerCarryOver' | 'optionMappings' | 'options'>;
  /** Currently published version answers would be carried over from (null = none, nothing to carry). */
  published: QuestionVersion | null;
  onChange: (patch: Partial<Pick<VersionForm, 'answerCarryOver' | 'optionMappings'>>) => void;
  errors: FieldErrors;
}

/**
 * What happens to existing answers when this version is published: dropped (users re-asked), kept as-is when the
 * option keys are identical, or mapped explicitly old option → new option. Unmapped options are re-asked.
 */
export function CarryOverEditor({ form, published, onChange, errors }: Props) {
  const mappingErrors = scopedErrors(errors, 'optionMappings');
  const prevKeys = published?.options.map((o) => o.key) ?? [];
  const newKeys = form.options.map((o) => o.key).filter(Boolean);
  const labelOf = (key: string) => {
    const o = published?.options.find((x) => x.key === key);
    const label = o ? published!.optionTranslations.find((tr) => tr.optionId === o.id && tr.locale === 'en')?.label : undefined;
    return label ? `${label} (${key})` : key;
  };
  const setMapping = (i: number, patch: Partial<MappingForm>) => onChange({ optionMappings: form.optionMappings.map((m, n) => (n === i ? { ...m, ...patch } : m)) });
  const unmapped = prevKeys.filter((k) => !form.optionMappings.some((m) => m.fromOptionKey === k));

  return (
    <fieldset className="stack">
      <legend>{t('questionnaire.carryOver.title')}</legend>
      <p className="field__hint">{published ? t('questionnaire.carryOver.hint', { version: published.version }) : t('questionnaire.carryOver.noPublished')}</p>
      <SelectField
        label={t('questionnaire.carryOver.mode')}
        value={form.answerCarryOver}
        onChange={(v) => onChange({ answerCarryOver: v as CarryOver })}
        options={CARRY_OVER.map((m) => ({ value: m, label: tDynamic(`questionnaire.carryOver.modes.${m}`, m) }))}
        error={errors.answerCarryOver}
      />
      {form.answerCarryOver === 'mapped' ? (
        published && isChoice(form.answerType) ? (
          <>
            {mappingErrors[''] ? <p className="field__error" role="alert">{mappingErrors['']}</p> : null}
            {form.optionMappings.length === 0 ? <p className="muted">{t('questionnaire.carryOver.noMappings')}</p> : null}
            <ol className="rules__list">
              {form.optionMappings.map((m, i) => {
                const e = scopedErrors(mappingErrors, String(i));
                const name = t('questionnaire.carryOver.mappingN', { n: i + 1 });
                return (
                  <li key={m.uid} className="row" aria-label={name}>
                    <SelectField label={t('questionnaire.carryOver.from')} value={m.fromOptionKey} onChange={(fromOptionKey) => setMapping(i, { fromOptionKey })} options={prevKeys.map((k) => ({ value: k, label: labelOf(k) }))} placeholder={t('questionnaire.carryOver.choose')} error={e.fromOptionKey} required className="field--inline" />
                    <SelectField label={t('questionnaire.carryOver.to')} value={m.toOptionKey} onChange={(toOptionKey) => setMapping(i, { toOptionKey })} options={[...new Set([...newKeys, ...(m.toOptionKey ? [m.toOptionKey] : [])])].map((k) => ({ value: k, label: k }))} placeholder={t('questionnaire.carryOver.choose')} error={e.toOptionKey} required className="field--inline" />
                    <Button variant="ghost" size="sm" onClick={() => onChange({ optionMappings: form.optionMappings.filter((_, n) => n !== i) })} aria-label={`${t('common.remove')} — ${name}`}>{t('common.remove')}</Button>
                  </li>
                );
              })}
            </ol>
            <div className="row">
              <Button variant="secondary" size="sm" disabled={form.optionMappings.length >= 200} onClick={() => onChange({ optionMappings: [...form.optionMappings, newMapping()] })}>{t('questionnaire.carryOver.addMapping')}</Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={!unmapped.some((k) => newKeys.includes(k))}
                onClick={() => onChange({ optionMappings: [...form.optionMappings, ...unmapped.filter((k) => newKeys.includes(k)).map((k) => newMapping(k, k))] })}
              >
                {t('questionnaire.carryOver.mapIdentical')}
              </Button>
            </div>
            {unmapped.length ? <p className="field__hint">{t('questionnaire.carryOver.unmapped', { keys: unmapped.join(', ') })}</p> : null}
          </>
        ) : (
          <p className="field__error" role="alert">{published ? t('questionnaire.carryOver.mappedNeedsChoice') : t('questionnaire.carryOver.noPublished')}</p>
        )
      ) : null}
    </fieldset>
  );
}
