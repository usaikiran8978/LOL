'use client';

import { Button } from '@/components/ui/Button';
import { CheckboxField, NumberField, SelectField, TextField } from '@/components/ui/fields';
import { t, tDynamic } from '@/i18n';
import type { ConditionOperator, QuestionListRow } from '@/lib/api/modules/questionnaire';
import { parseList, scopedErrors, type FieldErrors } from '@/lib/forms/validate';
import { CONDITION_OPERATORS, newCondition, NUMBER_OPERATORS, OPTION_OPERATORS, type ConditionForm } from './draft';
import { questionName, useOptionChoices } from './shared';

interface Props {
  /** The question being edited (excluded from targets: a question cannot depend on itself). */
  questionId: string | null;
  questions: QuestionListRow[];
  conditions: ConditionForm[];
  onChange: (conditions: ConditionForm[]) => void;
  errors: FieldErrors;
}

/**
 * Display conditions (`adminConditionInput`): the question is shown only when its conditions hold. Conditions
 * with the same group number are combined with AND; groups are combined with OR.
 */
export function ConditionsEditor({ questionId, questions, conditions, onChange, errors }: Props) {
  const set = (i: number, patch: Partial<ConditionForm>) => onChange(conditions.map((c, n) => (n === i ? { ...c, ...patch } : c)));
  const targets = questions.filter((q) => q.id !== questionId);

  return (
    <fieldset className="stack">
      <legend>{t('questionnaire.conditions.title')}</legend>
      <p className="field__hint">{t('questionnaire.conditions.hint')}</p>
      {conditions.length === 0 ? <p className="muted">{t('questionnaire.conditions.empty')}</p> : null}
      <ol className="rules__list">
        {conditions.map((c, i) => (
          <ConditionRow key={c.uid} index={i} condition={c} targets={targets} errors={scopedErrors(errors, String(i))} onChange={(patch) => set(i, patch)} onRemove={() => onChange(conditions.filter((_, n) => n !== i))} />
        ))}
      </ol>
      <Button variant="secondary" size="sm" disabled={conditions.length >= 20} onClick={() => onChange([...conditions, newCondition()])}>{t('questionnaire.conditions.add')}</Button>
    </fieldset>
  );
}

function ConditionRow({ index, condition: c, targets, errors, onChange, onRemove }: {
  index: number; condition: ConditionForm; targets: QuestionListRow[]; errors: FieldErrors; onChange: (patch: Partial<ConditionForm>) => void; onRemove: () => void;
}) {
  const name = t('questionnaire.conditions.conditionN', { n: index + 1 });
  const usesOptions = OPTION_OPERATORS.includes(c.operator);
  const usesNumber = NUMBER_OPERATORS.includes(c.operator);
  return (
    <li className="rule" aria-label={name}>
      <div className="grid grid--3">
        <NumberField label={t('questionnaire.conditions.group')} hint={t('questionnaire.conditions.groupHint')} value={c.groupNo} onChange={(groupNo) => onChange({ groupNo })} error={errors.groupNo} min={0} max={20} step={1} />
        <SelectField
          label={t('questionnaire.conditions.dependsOn')}
          value={c.dependsOnQuestionId}
          onChange={(dependsOnQuestionId) => onChange({ dependsOnQuestionId, optionKeys: [] })}
          options={targets.map((q) => ({ value: q.id, label: questionName(targets, q.id) }))}
          placeholder={t('questionnaire.conditions.chooseQuestion')}
          error={errors.dependsOnQuestionId}
          required
        />
        <SelectField
          label={t('questionnaire.conditions.operator')}
          value={c.operator}
          onChange={(v) => onChange({ operator: v as ConditionOperator })}
          options={CONDITION_OPERATORS.map((o) => ({ value: o, label: tDynamic(`questionnaire.conditions.ops.${o}`, o) }))}
          error={errors.operator}
        />
      </div>
      {usesOptions ? <OptionKeyPicker questionId={c.dependsOnQuestionId} value={c.optionKeys} onChange={(optionKeys) => onChange({ optionKeys })} error={errors.optionKeys} label={t('questionnaire.conditions.optionKeys')} /> : null}
      {usesNumber ? (
        <div className="grid grid--2">
          <NumberField label={c.operator === 'between' ? t('questionnaire.conditions.from') : t('questionnaire.conditions.number')} value={c.numberA} onChange={(numberA) => onChange({ numberA })} error={errors.numberA} step="any" required />
          {c.operator === 'between' ? <NumberField label={t('questionnaire.conditions.to')} value={c.numberB} onChange={(numberB) => onChange({ numberB })} error={errors.numberB} step="any" required /> : null}
        </div>
      ) : null}
      <div className="row">
        <Button variant="ghost" size="sm" onClick={onRemove} aria-label={`${t('common.remove')} — ${name}`}>{t('common.remove')}</Button>
      </div>
    </li>
  );
}

/** Checkboxes for the target question's option keys; falls back to a typed list when they cannot be loaded. */
export function OptionKeyPicker({ questionId, value, onChange, error, label }: { questionId: string; value: string[]; onChange: (keys: string[]) => void; error?: string; label: string }) {
  const choices = useOptionChoices(questionId);
  if (!questionId) return <p className="muted">{t('questionnaire.conditions.pickQuestionFirst')}</p>;
  if (choices.status === 'loading') return <p className="muted">{t('app.loading')}</p>;
  if (choices.status === 'error' || !choices.data || choices.data.keys.length === 0) {
    return (
      <TextField
        label={label}
        hint={choices.status === 'error' ? t('questionnaire.conditions.optionsUnavailable') : t('questionnaire.conditions.noOptions')}
        value={value.join(', ')}
        onChange={(v) => onChange(parseList(v))}
        error={error}
        spellCheck={false}
      />
    );
  }
  const keys = choices.data.keys;
  return (
    <fieldset className="checkbox-group">
      <legend>{label}</legend>
      {!choices.data.published ? <p className="field__hint">{t('questionnaire.conditions.unpublishedTarget')}</p> : null}
      {keys.map((k) => (
        <CheckboxField
          key={k.key}
          label={`${k.label} (${k.key})`}
          checked={value.includes(k.key)}
          onChange={(on) => onChange(on ? [...value, k.key] : value.filter((x) => x !== k.key))}
        />
      ))}
      {value.filter((v) => !keys.some((k) => k.key === v)).map((stale) => (
        <CheckboxField key={stale} label={t('questionnaire.conditions.staleKey', { key: stale })} checked onChange={() => onChange(value.filter((x) => x !== stale))} />
      ))}
      {error ? <p className="field__error" role="alert">{error}</p> : null}
    </fieldset>
  );
}
