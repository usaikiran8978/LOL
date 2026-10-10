import { adminVersionInput } from '@amora/shared';
import { describe, expect, it } from 'vitest';
import { t } from '@/i18n';
import { emptyVersionForm, formToPayload, newCondition, newMapping, newOption, versionToForm } from './draft';
import { Q2_ID, v1, v2Draft } from './test-fixtures';

describe('draft model', () => {
  it('round-trips a server version into a payload accepted by the shared contract', () => {
    const { payload, errors } = formToPayload(versionToForm(v1));
    expect(errors).toEqual({});
    const parsed = adminVersionInput.safeParse(payload);
    expect(parsed.success).toBe(true);
    expect(payload).toMatchObject({
      answerType: 'single_choice', weight: 2, compatibilityCategoryId: null, answerCarryOver: 'none', targeting: null,
      translations: { en: { text: 'Coffee or tea?' } },
      options: [
        { key: 'coffee', numericValue: 1, isExclusive: false, translations: { en: { label: 'Coffee' } } },
        { key: 'tea', numericValue: 2, isExclusive: false, translations: { en: { label: 'Tea' } } },
      ],
      optionMappings: [],
    });
  });

  it('keeps conditions, rules, mappings and targeting from the server', () => {
    const form = versionToForm({
      ...v2Draft,
      targeting: { field: 'countryCode', op: 'eq', value: 'IN' },
      answerCarryOver: 'mapped',
      optionMappings: [{ fromOptionKey: 'coffee', toOptionKey: 'tea' }],
      conditions: [{ id: 'c1', groupNo: 1, dependsOnQuestionId: Q2_ID, operator: 'includes_any', optionKeys: ['yes'], numberA: null, numberB: null }],
      rules: [{ id: 'r1', sourceOptionId: 'o3', sourceOptionKey: 'coffee', targetQuestionId: Q2_ID, targetOptionKey: null, ruleType: 'negative', scoreDelta: -0.5, isExclusion: false, isBidirectional: true, description: null }],
    });
    const { payload, errors } = formToPayload(form);
    expect(errors).toEqual({});
    expect(payload).toMatchObject({
      targeting: { field: 'countryCode', op: 'eq', value: 'IN' },
      optionMappings: [{ fromOptionKey: 'coffee', toOptionKey: 'tea' }],
      conditions: [{ groupNo: 1, dependsOnQuestionId: Q2_ID, operator: 'includes_any', optionKeys: ['yes'] }],
      rules: [{ sourceOptionKey: 'coffee', targetQuestionId: Q2_ID, targetOptionKey: null, ruleType: 'negative', scoreDelta: -0.5 }],
      changeNote: 'Copy',
    });
    expect(adminVersionInput.safeParse(payload).success).toBe(true);
  });

  it('nulls constraints that do not apply to the answer type and drops options for non-choice types', () => {
    const form = { ...versionToForm(v1), answerType: 'scale' as const, scaleMin: 1, scaleMax: 5, scaleStep: 1, minSelections: 2, numericUnit: 'cm' };
    const { payload } = formToPayload(form);
    expect(payload).toMatchObject({ scaleMin: 1, scaleMax: 5, scaleStep: 1, minSelections: null, numericUnit: null, options: [] });
    const text = formToPayload({ ...form, answerType: 'text', textMaxLength: 300, isScored: true }).payload;
    expect(text).toMatchObject({ isScored: false, textMaxLength: 300, scaleMin: null });
  });

  it('reports duplicate option keys, incomplete conditions, invalid targeting and bad mappings', () => {
    const form = {
      ...emptyVersionForm(),
      options: [newOption('a', 'A'), newOption('a', 'A again')],
      conditions: [{ ...newCondition(), operator: 'includes_any' as const }, { ...newCondition(), operator: 'between' as const, numberA: 1 }],
      targeting: { enabled: true, initial: null, result: { ok: false as const, error: 'missing_field' as const } },
      answerCarryOver: 'mapped' as const,
      optionMappings: [newMapping('old', 'zzz')],
    };
    const { errors } = formToPayload(form);
    expect(errors).toEqual({
      'options.1.key': t('validation.duplicate', { value: 'a' }),
      'conditions.0.optionKeys': t('validation.tooFewItems', { min: 1 }),
      'conditions.1.numberB': t('validation.required'),
      targeting: t('questionnaire.editor.targetingInvalid'),
      'optionMappings.0.toOptionKey': t('validation.invalidOption'),
    });
  });

  it('omits blank optional translations and empty change notes', () => {
    const form = emptyVersionForm();
    form.translations = { en: { text: 'Hi', helpText: '', scaleMinLabel: '', scaleMaxLabel: '' } };
    const { payload } = formToPayload(form);
    expect(payload.translations).toEqual({ en: { text: 'Hi' } });
    expect('changeNote' in payload).toBe(false);
  });
});
