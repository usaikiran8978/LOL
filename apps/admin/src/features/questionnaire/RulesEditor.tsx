'use client';

import { Button } from '@/components/ui/Button';
import { CheckboxField, NumberField, SelectField, TextField } from '@/components/ui/fields';
import { t, tDynamic } from '@/i18n';
import type { QuestionListRow, RuleType } from '@/lib/api/modules/questionnaire';
import { scopedErrors, type FieldErrors } from '@/lib/forms/validate';
import { newRule, RULE_TYPES, type OptionForm, type RuleForm } from './draft';
import { questionName, useOptionChoices } from './shared';

interface Props {
  questionId: string | null;
  questions: QuestionListRow[];
  /** This draft's options (rule sources, and targets when the rule targets this same question). */
  options: OptionForm[];
  rules: RuleForm[];
  onChange: (rules: RuleForm[]) => void;
  errors: FieldErrors;
}

/** Compatibility rules (`adminRuleInput`): how answers to this question score against answers to a target question. */
export function RulesEditor({ questionId, questions, options, rules, onChange, errors }: Props) {
  const set = (i: number, patch: Partial<RuleForm>) => onChange(rules.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  return (
    <fieldset className="stack">
      <legend>{t('questionnaire.rules.title')}</legend>
      <p className="field__hint">{t('questionnaire.rules.hint')}</p>
      {rules.length === 0 ? <p className="muted">{t('questionnaire.rules.empty')}</p> : null}
      <ol className="rules__list">
        {rules.map((r, i) => (
          <RuleRow
            key={r.uid}
            index={i}
            rule={r}
            questionId={questionId}
            questions={questions}
            options={options}
            errors={scopedErrors(errors, String(i))}
            onChange={(patch) => set(i, patch)}
            onRemove={() => onChange(rules.filter((_, n) => n !== i))}
          />
        ))}
      </ol>
      <Button variant="secondary" size="sm" disabled={rules.length >= 200} onClick={() => onChange([...rules, newRule()])}>{t('questionnaire.rules.add')}</Button>
    </fieldset>
  );
}

function RuleRow({ index, rule: r, questionId, questions, options, errors, onChange, onRemove }: {
  index: number; rule: RuleForm; questionId: string | null; questions: QuestionListRow[]; options: OptionForm[]; errors: FieldErrors;
  onChange: (patch: Partial<RuleForm>) => void; onRemove: () => void;
}) {
  const name = t('questionnaire.rules.ruleN', { n: index + 1 });
  const isSelf = !!questionId && r.targetQuestionId === questionId;
  // Remote choices are loaded only for other questions; a self-targeting rule uses this draft's options.
  const remote = useOptionChoices(isSelf ? '' : r.targetQuestionId);
  const ownKeys = options.filter((o) => o.key).map((o) => ({ key: o.key, label: o.translations.en?.label || o.key }));
  const targetKeys = isSelf ? ownKeys : remote.data?.keys ?? [];
  const keyOptions = (keys: Array<{ key: string; label: string }>, current: string) => {
    const opts = keys.map((k) => ({ value: k.key, label: `${k.label} (${k.key})` }));
    if (current && !keys.some((k) => k.key === current)) opts.push({ value: current, label: current });
    return opts;
  };
  const targetOptions = [
    ...(questionId ? [{ value: questionId, label: t('questionnaire.rules.thisQuestion') }] : []),
    ...questions.filter((q) => q.id !== questionId).map((q) => ({ value: q.id, label: questionName(questions, q.id) })),
  ];

  return (
    <li className="rule" aria-label={name}>
      <div className="grid grid--3">
        <SelectField label={t('questionnaire.rules.sourceOption')} value={r.sourceOptionKey} onChange={(sourceOptionKey) => onChange({ sourceOptionKey })} options={keyOptions(ownKeys, r.sourceOptionKey)} placeholder={t('questionnaire.rules.anyAnswer')} error={errors.sourceOptionKey} />
        <SelectField label={t('questionnaire.rules.targetQuestion')} value={r.targetQuestionId} onChange={(targetQuestionId) => onChange({ targetQuestionId, targetOptionKey: '' })} options={targetOptions} placeholder={t('questionnaire.conditions.chooseQuestion')} error={errors.targetQuestionId} required />
        {r.targetQuestionId && !isSelf && remote.status === 'error' ? (
          <TextField label={t('questionnaire.rules.targetOption')} hint={t('questionnaire.conditions.optionsUnavailable')} value={r.targetOptionKey} onChange={(targetOptionKey) => onChange({ targetOptionKey: targetOptionKey.trim() })} error={errors.targetOptionKey} spellCheck={false} />
        ) : (
          <SelectField label={t('questionnaire.rules.targetOption')} value={r.targetOptionKey} onChange={(targetOptionKey) => onChange({ targetOptionKey })} options={keyOptions(targetKeys, r.targetOptionKey)} placeholder={t('questionnaire.rules.anyOption')} error={errors.targetOptionKey} disabled={!r.targetQuestionId} />
        )}
        <SelectField label={t('questionnaire.rules.ruleType')} value={r.ruleType} onChange={(v) => onChange({ ruleType: v as RuleType })} options={RULE_TYPES.map((x) => ({ value: x, label: tDynamic(`questionnaire.rules.types.${x}`, x) }))} error={errors.ruleType} />
        <NumberField label={t('questionnaire.rules.scoreDelta')} hint={t('questionnaire.rules.scoreDeltaHint')} value={r.scoreDelta} onChange={(scoreDelta) => onChange({ scoreDelta })} error={errors.scoreDelta} min={-1} max={1} step="any" required />
        <TextField label={t('common.description')} value={r.description} onChange={(description) => onChange({ description })} error={errors.description} maxLength={500} />
      </div>
      <div className="row">
        <CheckboxField label={t('questionnaire.rules.isExclusion')} hint={r.ruleType === 'dealbreaker' ? t('questionnaire.rules.dealbreakerExcludes') : undefined} checked={r.isExclusion || r.ruleType === 'dealbreaker'} disabled={r.ruleType === 'dealbreaker'} onChange={(isExclusion) => onChange({ isExclusion })} />
        <CheckboxField label={t('questionnaire.rules.isBidirectional')} checked={r.isBidirectional} onChange={(isBidirectional) => onChange({ isBidirectional })} />
        <Button variant="ghost" size="sm" onClick={onRemove} aria-label={`${t('common.remove')} — ${name}`}>{t('common.remove')}</Button>
      </div>
    </li>
  );
}
