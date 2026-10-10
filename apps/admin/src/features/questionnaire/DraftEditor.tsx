'use client';

import type { AnswerType } from '@amora/shared';
import { PredicateBuilder } from '@/components/editors/PredicateBuilder';
import { TranslationEditor } from '@/components/editors/TranslationEditor';
import { CheckboxField, NumberField, ReadOnlyField, SelectField, TextAreaField, TextField } from '@/components/ui/fields';
import { t, tDynamic } from '@/i18n';
import type { QuestionVersion, Visibility } from '@/lib/api/modules/questionnaire';
import { scopedErrors, type FieldErrors } from '@/lib/forms/validate';
import { CarryOverEditor } from './CarryOverEditor';
import { ConditionsEditor } from './ConditionsEditor';
import { ANSWER_TYPES, isChoice, MULTI_SELECT_TYPES, textFieldsFor, VISIBILITIES, type VersionForm } from './draft';
import { OptionsEditor } from './OptionsEditor';
import { RulesEditor } from './RulesEditor';
import { compatName, labelOf, type QuestionnaireRefs } from './shared';

interface Props {
  form: VersionForm;
  onChange: (patch: Partial<VersionForm>) => void;
  /** Errors keyed by `adminVersionInput` path. */
  errors: FieldErrors;
  refs: QuestionnaireRefs;
  /** Null while creating a new question. */
  questionId: string | null;
  /** Published version answers carry over from; null hides carry-over (nothing to carry). */
  published: QuestionVersion | null;
}

/** Full editor for one question version (draft content). Controlled: the page owns state and saving. */
export function DraftEditor({ form, onChange, errors, refs, questionId, published }: Props) {
  const type = form.answerType;
  const multi = MULTI_SELECT_TYPES.includes(type);

  return (
    <div className="stack">
      <section className="card stack" aria-labelledby="qe-basics">
        <h2 id="qe-basics" className="card__title">{t('questionnaire.editor.basics')}</h2>
        <SelectField
          label={t('questionnaire.editor.answerType')}
          hint={tDynamic(`questionnaire.answerTypeHints.${type}`, '')}
          value={type}
          onChange={(v) => onChange({ answerType: v as AnswerType })}
          options={ANSWER_TYPES.map((a) => ({ value: a, label: tDynamic(`questionnaire.answerTypes.${a}`, a) }))}
          error={errors.answerType}
          required
        />
        <TranslationEditor fields={textFieldsFor(type)} value={form.translations} onChange={(translations) => onChange({ translations })} errors={scopedErrors(errors, 'translations')} />
        <TextAreaField label={t('questionnaire.editor.changeNote')} hint={t('questionnaire.editor.changeNoteHint')} value={form.changeNote} onChange={(changeNote) => onChange({ changeNote })} error={errors.changeNote} maxLength={1000} rows={2} />
      </section>

      {type === 'scale' || type === 'numeric_range' || type === 'text' || multi ? (
        <section className="card stack" aria-labelledby="qe-constraints">
          <h2 id="qe-constraints" className="card__title">{t('questionnaire.editor.constraints')}</h2>
          {type === 'scale' ? (
            <div className="grid grid--3">
              <NumberField label={t('questionnaire.editor.scaleMin')} value={form.scaleMin} onChange={(scaleMin) => onChange({ scaleMin })} error={errors.scaleMin} step={1} required />
              <NumberField label={t('questionnaire.editor.scaleMax')} value={form.scaleMax} onChange={(scaleMax) => onChange({ scaleMax })} error={errors.scaleMax} step={1} required />
              <NumberField label={t('questionnaire.editor.scaleStep')} value={form.scaleStep} onChange={(scaleStep) => onChange({ scaleStep })} error={errors.scaleStep} min={1} step={1} />
            </div>
          ) : null}
          {type === 'numeric_range' ? (
            <div className="grid grid--3">
              <NumberField label={t('questionnaire.editor.numericMin')} value={form.numericMin} onChange={(numericMin) => onChange({ numericMin })} error={errors.numericMin} step="any" />
              <NumberField label={t('questionnaire.editor.numericMax')} value={form.numericMax} onChange={(numericMax) => onChange({ numericMax })} error={errors.numericMax} step="any" />
              <TextField label={t('questionnaire.editor.numericUnit')} hint={t('questionnaire.editor.numericUnitHint')} value={form.numericUnit} onChange={(numericUnit) => onChange({ numericUnit })} error={errors.numericUnit} maxLength={20} />
            </div>
          ) : null}
          {type === 'text' ? (
            <NumberField label={t('questionnaire.editor.textMaxLength')} value={form.textMaxLength} onChange={(textMaxLength) => onChange({ textMaxLength })} error={errors.textMaxLength} min={1} max={2000} step={1} />
          ) : null}
          {multi ? (
            <div className="grid grid--2">
              <NumberField label={t('questionnaire.editor.minSelections')} value={form.minSelections} onChange={(minSelections) => onChange({ minSelections })} error={errors.minSelections} min={1} max={30} step={1} />
              <NumberField label={t('questionnaire.editor.maxSelections')} value={form.maxSelections} onChange={(maxSelections) => onChange({ maxSelections })} error={errors.maxSelections} min={1} max={30} step={1} />
            </div>
          ) : null}
        </section>
      ) : null}

      {isChoice(type) ? (
        <section className="card" aria-label={t('questionnaire.options.title')}>
          <OptionsEditor answerType={type} options={form.options} onChange={(options) => onChange({ options })} errors={scopedErrors(errors, 'options')} />
        </section>
      ) : null}

      <section className="card stack" aria-labelledby="qe-scoring">
        <h2 id="qe-scoring" className="card__title">{t('questionnaire.editor.scoring')}</h2>
        <CheckboxField label={t('questionnaire.editor.isScored')} hint={type === 'text' ? t('questionnaire.editor.textNotScored') : t('questionnaire.editor.isScoredHint')} checked={type === 'text' ? false : form.isScored} disabled={type === 'text'} onChange={(isScored) => onChange({ isScored })} error={errors.isScored} />
        <div className="grid grid--2">
          <NumberField label={t('questionnaire.editor.weight')} hint={t('questionnaire.editor.weightHint')} value={form.weight} onChange={(weight) => onChange({ weight })} error={errors.weight} min={0} max={100} step="any" required />
          {refs.compatCategories ? (
            <SelectField
              label={t('questionnaire.editor.compatCategory')}
              hint={t('questionnaire.editor.compatCategoryHint')}
              value={form.compatibilityCategoryId}
              onChange={(compatibilityCategoryId) => onChange({ compatibilityCategoryId })}
              options={refs.compatCategories.map((c) => ({ value: c.id, label: c.is_active ? labelOf(c) : `${labelOf(c)} (${t('common.inactive')})` }))}
              placeholder={t('questionnaire.editor.noCompatCategory')}
              error={errors.compatibilityCategoryId}
            />
          ) : (
            <ReadOnlyField label={t('questionnaire.editor.compatCategory')} value={compatName(null, form.compatibilityCategoryId || null)} hint={t('questionnaire.editor.compatNeedsPermission')} />
          )}
        </div>
        <CheckboxField label={t('questionnaire.editor.allowImportance')} hint={t('questionnaire.editor.allowImportanceHint')} checked={form.allowImportance} onChange={(allowImportance) => onChange({ allowImportance })} />
        <CheckboxField label={t('questionnaire.editor.allowDealbreaker')} hint={t('questionnaire.editor.allowDealbreakerHint')} checked={form.allowDealbreaker} onChange={(allowDealbreaker) => onChange({ allowDealbreaker })} />
      </section>

      <section className="card stack" aria-labelledby="qe-behaviour">
        <h2 id="qe-behaviour" className="card__title">{t('questionnaire.editor.behaviour')}</h2>
        <CheckboxField label={t('questionnaire.editor.isRequired')} hint={t('questionnaire.editor.isRequiredHint')} checked={form.isRequired} onChange={(isRequired) => onChange({ isRequired })} error={errors.isRequired} />
        <CheckboxField label={t('questionnaire.editor.allowSkip')} hint={t('questionnaire.editor.allowSkipHint')} checked={form.allowSkip} onChange={(allowSkip) => onChange({ allowSkip })} />
        <SelectField
          label={t('questionnaire.editor.visibility')}
          value={form.visibility}
          onChange={(v) => onChange({ visibility: v as Visibility })}
          options={VISIBILITIES.map((v) => ({ value: v, label: tDynamic(`questionnaire.visibility.${v}`, v) }))}
          error={errors.visibility}
        />
      </section>

      <section className="card stack" aria-labelledby="qe-targeting">
        <h2 id="qe-targeting" className="card__title">{t('questionnaire.editor.targeting')}</h2>
        <CheckboxField
          label={t('questionnaire.editor.targetingEnabled')}
          hint={t('questionnaire.editor.targetingHint')}
          checked={form.targeting.enabled}
          onChange={(enabled) => onChange({ targeting: { ...form.targeting, enabled } })}
        />
        {form.targeting.enabled ? (
          <PredicateBuilder
            label={t('questionnaire.editor.targetingRule')}
            initial={form.targeting.initial}
            onChange={(result) => onChange({ targeting: { ...form.targeting, enabled: true, result } })}
          />
        ) : null}
        {errors.targeting ? <p className="field__error" role="alert">{errors.targeting}</p> : null}
      </section>

      <section className="card" aria-label={t('questionnaire.conditions.title')}>
        <ConditionsEditor questionId={questionId} questions={refs.questions} conditions={form.conditions} onChange={(conditions) => onChange({ conditions })} errors={scopedErrors(errors, 'conditions')} />
      </section>

      <section className="card" aria-label={t('questionnaire.rules.title')}>
        <RulesEditor questionId={questionId} questions={refs.questions} options={isChoice(type) ? form.options : []} rules={form.rules} onChange={(rules) => onChange({ rules })} errors={scopedErrors(errors, 'rules')} />
      </section>

      {questionId ? (
        <section className="card" aria-label={t('questionnaire.carryOver.title')}>
          <CarryOverEditor form={form} published={published} onChange={onChange} errors={errors} />
        </section>
      ) : null}
    </div>
  );
}
