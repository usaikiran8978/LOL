import { ANSWER_TYPES, type AnswerType, type Predicate } from '@amora/shared';
import {
  emptyTranslation, translationsFromServer, translationsToPayload, type TranslationFieldSpec, type TranslationValues,
} from '@/components/editors/TranslationEditor';
import { t } from '@/i18n';
import type { CarryOver, ConditionOperator, QuestionVersion, RuleType, Visibility } from '@/lib/api/modules/questionnaire';
import type { FieldErrors } from '@/lib/forms/validate';
import type { Conversion } from '@/lib/predicate';

/*
 * Editable model of a question version (`adminVersionInput`). Numbers are `number | undefined` while editing so
 * zod reports empty input; `formToPayload` maps the model onto the shared contract (nulls for fields that do not
 * apply to the chosen answer type) and returns local errors zod cannot express (duplicate keys, targeting).
 */

export { ANSWER_TYPES };
export const CHOICE_TYPES: readonly AnswerType[] = ['single_choice', 'multiple_choice', 'yes_no', 'ranking', 'structured_preference'];
export const MULTI_SELECT_TYPES: readonly AnswerType[] = ['multiple_choice', 'ranking', 'structured_preference'];
export const VISIBILITIES: readonly Visibility[] = ['private', 'matches_only', 'public_profile'];
export const CARRY_OVER: readonly CarryOver[] = ['none', 'same_options', 'mapped'];
export const CONDITION_OPERATORS: readonly ConditionOperator[] = ['answered', 'not_answered', 'includes_any', 'includes_all', 'excludes', 'eq', 'gte', 'lte', 'between'];
export const OPTION_OPERATORS: readonly ConditionOperator[] = ['includes_any', 'includes_all', 'excludes'];
export const NUMBER_OPERATORS: readonly ConditionOperator[] = ['eq', 'gte', 'lte', 'between'];
export const RULE_TYPES: readonly RuleType[] = ['positive', 'negative', 'dealbreaker', 'similarity', 'distance'];

export const isChoice = (type: AnswerType) => CHOICE_TYPES.includes(type);

export type VersionTrField = 'text' | 'helpText' | 'scaleMinLabel' | 'scaleMaxLabel';

export const QUESTION_TEXT_FIELDS: readonly TranslationFieldSpec<VersionTrField>[] = [
  { name: 'text', labelKey: 'questionnaire.editor.text', kind: 'textarea', maxLength: 500 },
  { name: 'helpText', labelKey: 'questionnaire.editor.helpText', kind: 'textarea', optional: true, maxLength: 1000 },
  { name: 'scaleMinLabel', labelKey: 'questionnaire.editor.scaleMinLabel', optional: true, maxLength: 80 },
  { name: 'scaleMaxLabel', labelKey: 'questionnaire.editor.scaleMaxLabel', optional: true, maxLength: 80 },
];

/** Scale labels only make sense for scale questions; the editor hides them otherwise. */
export function textFieldsFor(type: AnswerType): readonly TranslationFieldSpec<VersionTrField>[] {
  return type === 'scale' ? QUESTION_TEXT_FIELDS : QUESTION_TEXT_FIELDS.slice(0, 2);
}

export const OPTION_LABEL_FIELDS: readonly TranslationFieldSpec<'label'>[] = [{ name: 'label', labelKey: 'questionnaire.options.label', maxLength: 200 }];

export interface OptionForm {
  uid: string;
  key: string;
  numericValue: number | undefined;
  isExclusive: boolean;
  translations: TranslationValues<'label'>;
}

export interface ConditionForm {
  uid: string;
  groupNo: number | undefined;
  dependsOnQuestionId: string;
  operator: ConditionOperator;
  optionKeys: string[];
  numberA: number | undefined;
  numberB: number | undefined;
}

export interface RuleForm {
  uid: string;
  /** '' = applies to any answer of this question. */
  sourceOptionKey: string;
  targetQuestionId: string;
  /** '' = any option of the target. */
  targetOptionKey: string;
  ruleType: RuleType;
  scoreDelta: number | undefined;
  isExclusion: boolean;
  isBidirectional: boolean;
  description: string;
}

export interface MappingForm {
  uid: string;
  fromOptionKey: string;
  toOptionKey: string;
}

export interface TargetingForm {
  enabled: boolean;
  /** Seed for the (uncontrolled) PredicateBuilder. */
  initial: Predicate | null;
  /** Latest conversion reported by the builder. */
  result: Conversion | null;
}

export interface VersionForm {
  answerType: AnswerType;
  isRequired: boolean;
  weight: number | undefined;
  compatibilityCategoryId: string;
  isScored: boolean;
  visibility: Visibility;
  allowImportance: boolean;
  allowDealbreaker: boolean;
  allowSkip: boolean;
  minSelections: number | undefined;
  maxSelections: number | undefined;
  scaleMin: number | undefined;
  scaleMax: number | undefined;
  scaleStep: number | undefined;
  numericMin: number | undefined;
  numericMax: number | undefined;
  numericUnit: string;
  textMaxLength: number | undefined;
  targeting: TargetingForm;
  answerCarryOver: CarryOver;
  optionMappings: MappingForm[];
  changeNote: string;
  translations: TranslationValues<VersionTrField>;
  options: OptionForm[];
  conditions: ConditionForm[];
  rules: RuleForm[];
}

let seq = 0;
export const uid = () => `q${++seq}`;
const num = (v: number | null | undefined) => (v === null ? undefined : v);

export function newOption(key = '', label = ''): OptionForm {
  const translations: TranslationValues<'label'> = { en: emptyTranslation(OPTION_LABEL_FIELDS) };
  translations.en!.label = label;
  return { uid: uid(), key, numericValue: undefined, isExclusive: false, translations };
}

export function newCondition(): ConditionForm {
  return { uid: uid(), groupNo: 0, dependsOnQuestionId: '', operator: 'answered', optionKeys: [], numberA: undefined, numberB: undefined };
}

export function newRule(): RuleForm {
  return { uid: uid(), sourceOptionKey: '', targetQuestionId: '', targetOptionKey: '', ruleType: 'positive', scoreDelta: 0, isExclusion: false, isBidirectional: true, description: '' };
}

export function newMapping(fromOptionKey = '', toOptionKey = ''): MappingForm {
  return { uid: uid(), fromOptionKey, toOptionKey };
}

export function emptyVersionForm(): VersionForm {
  return {
    answerType: 'single_choice', isRequired: false, weight: 1, compatibilityCategoryId: '', isScored: true, visibility: 'private',
    allowImportance: true, allowDealbreaker: false, allowSkip: true, minSelections: undefined, maxSelections: undefined,
    scaleMin: undefined, scaleMax: undefined, scaleStep: undefined, numericMin: undefined, numericMax: undefined, numericUnit: '', textMaxLength: undefined,
    targeting: { enabled: false, initial: null, result: null }, answerCarryOver: 'none', optionMappings: [], changeNote: '',
    translations: { en: emptyTranslation(QUESTION_TEXT_FIELDS) }, options: [], conditions: [], rules: [],
  };
}

/** Server version → editor model. */
export function versionToForm(v: QuestionVersion): VersionForm {
  const vtr: Record<string, Partial<Record<VersionTrField, string | null>>> = {};
  for (const tr of v.translations) vtr[tr.locale] = { text: tr.text, helpText: tr.helpText, scaleMinLabel: tr.scaleMinLabel, scaleMaxLabel: tr.scaleMaxLabel };
  return {
    answerType: v.answerType, isRequired: v.isRequired, weight: v.weight, compatibilityCategoryId: v.compatibilityCategoryId ?? '', isScored: v.isScored,
    visibility: v.visibility, allowImportance: v.allowImportance, allowDealbreaker: v.allowDealbreaker, allowSkip: v.allowSkip,
    minSelections: num(v.minSelections), maxSelections: num(v.maxSelections), scaleMin: num(v.scaleMin), scaleMax: num(v.scaleMax), scaleStep: num(v.scaleStep),
    numericMin: num(v.numericMin), numericMax: num(v.numericMax), numericUnit: v.numericUnit ?? '', textMaxLength: num(v.textMaxLength),
    targeting: { enabled: v.targeting !== null, initial: v.targeting, result: v.targeting ? { ok: true, value: v.targeting } : null },
    answerCarryOver: v.answerCarryOver,
    optionMappings: v.optionMappings.map((m) => newMapping(m.fromOptionKey, m.toOptionKey)),
    changeNote: v.changeNote ?? '',
    translations: translationsFromServer(QUESTION_TEXT_FIELDS, vtr),
    options: v.options.map((o) => {
      const otr: Record<string, { label: string }> = {};
      for (const tr of v.optionTranslations) if (tr.optionId === o.id) otr[tr.locale] = { label: tr.label };
      return { uid: uid(), key: o.key, numericValue: num(o.numericValue), isExclusive: o.isExclusive, translations: translationsFromServer(OPTION_LABEL_FIELDS, otr) };
    }),
    conditions: v.conditions.map((c) => ({
      uid: uid(), groupNo: c.groupNo, dependsOnQuestionId: c.dependsOnQuestionId, operator: c.operator, optionKeys: c.optionKeys ?? [], numberA: num(c.numberA), numberB: num(c.numberB),
    })),
    rules: v.rules.map((r) => ({
      uid: uid(), sourceOptionKey: r.sourceOptionKey ?? '', targetQuestionId: r.targetQuestionId, targetOptionKey: r.targetOptionKey ?? '', ruleType: r.ruleType,
      scoreDelta: r.scoreDelta, isExclusion: r.isExclusion, isBidirectional: r.isBidirectional, description: r.description ?? '',
    })),
  };
}

const orNull = <T>(v: T | undefined): T | null => (v === undefined ? null : v);

/** Editor model → `adminVersionInput` body plus local errors keyed by contract path. */
export function formToPayload(form: VersionForm): { payload: Record<string, unknown>; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const type = form.answerType;
  const choice = isChoice(type);
  const multi = MULTI_SELECT_TYPES.includes(type);

  const seen = new Set<string>();
  form.options.forEach((o, i) => {
    if (!choice || o.key === '') return;
    if (seen.has(o.key)) errors[`options.${i}.key`] = t('validation.duplicate', { value: o.key });
    seen.add(o.key);
  });

  let targeting: Predicate | null = null;
  if (form.targeting.enabled) {
    if (form.targeting.result?.ok) targeting = form.targeting.result.value;
    else errors.targeting = t('questionnaire.editor.targetingInvalid');
  }

  const payload: Record<string, unknown> = {
    answerType: type,
    isRequired: form.isRequired,
    weight: form.weight,
    compatibilityCategoryId: form.compatibilityCategoryId || null,
    // The API forces text questions to unscored; mirror it so the saved draft matches what was sent.
    isScored: type === 'text' ? false : form.isScored,
    visibility: form.visibility,
    allowImportance: form.allowImportance,
    allowDealbreaker: form.allowDealbreaker,
    allowSkip: form.allowSkip,
    minSelections: multi ? orNull(form.minSelections) : null,
    maxSelections: multi ? orNull(form.maxSelections) : null,
    scaleMin: type === 'scale' ? orNull(form.scaleMin) : null,
    scaleMax: type === 'scale' ? orNull(form.scaleMax) : null,
    scaleStep: type === 'scale' ? orNull(form.scaleStep) : null,
    numericMin: type === 'numeric_range' ? orNull(form.numericMin) : null,
    numericMax: type === 'numeric_range' ? orNull(form.numericMax) : null,
    numericUnit: type === 'numeric_range' && form.numericUnit.trim() ? form.numericUnit.trim() : null,
    textMaxLength: type === 'text' ? orNull(form.textMaxLength) : null,
    targeting,
    answerCarryOver: form.answerCarryOver,
    optionMappings: form.answerCarryOver === 'mapped' ? form.optionMappings.map((m) => ({ fromOptionKey: m.fromOptionKey, toOptionKey: m.toOptionKey })) : [],
    translations: translationsToPayload(textFieldsFor(type), form.translations),
    options: choice
      ? form.options.map((o) => ({
          key: o.key,
          ...(o.numericValue === undefined ? {} : { numericValue: o.numericValue }),
          isExclusive: o.isExclusive,
          translations: translationsToPayload(OPTION_LABEL_FIELDS, o.translations),
        }))
      : [],
    conditions: form.conditions.map((c) => {
      const usesOptions = OPTION_OPERATORS.includes(c.operator);
      const usesA = NUMBER_OPERATORS.includes(c.operator);
      return {
        groupNo: c.groupNo,
        dependsOnQuestionId: c.dependsOnQuestionId,
        operator: c.operator,
        ...(usesOptions ? { optionKeys: c.optionKeys } : {}),
        ...(usesA ? { numberA: c.numberA } : {}),
        ...(c.operator === 'between' ? { numberB: c.numberB } : {}),
      };
    }),
    rules: form.rules.map((r) => ({
      sourceOptionKey: r.sourceOptionKey || null,
      targetQuestionId: r.targetQuestionId,
      targetOptionKey: r.targetOptionKey || null,
      ruleType: r.ruleType,
      scoreDelta: r.scoreDelta,
      isExclusion: r.isExclusion,
      isBidirectional: r.isBidirectional,
      ...(r.description.trim() ? { description: r.description.trim() } : {}),
    })),
  };
  if (form.changeNote.trim()) payload.changeNote = form.changeNote.trim();

  form.conditions.forEach((c, i) => {
    if (OPTION_OPERATORS.includes(c.operator) && c.optionKeys.length === 0) errors[`conditions.${i}.optionKeys`] = t('validation.tooFewItems', { min: 1 });
    if (NUMBER_OPERATORS.includes(c.operator) && c.numberA === undefined) errors[`conditions.${i}.numberA`] = t('validation.required');
    if (c.operator === 'between' && c.numberB === undefined) errors[`conditions.${i}.numberB`] = t('validation.required');
  });
  if (form.answerCarryOver === 'mapped') {
    form.optionMappings.forEach((m, i) => {
      if (!m.fromOptionKey) errors[`optionMappings.${i}.fromOptionKey`] = t('validation.required');
      if (!m.toOptionKey) errors[`optionMappings.${i}.toOptionKey`] = t('validation.required');
      else if (!form.options.some((o) => o.key === m.toOptionKey)) errors[`optionMappings.${i}.toOptionKey`] = t('validation.invalidOption');
    });
  }
  return { payload, errors };
}
