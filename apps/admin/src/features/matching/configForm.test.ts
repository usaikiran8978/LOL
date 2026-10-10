import { adminMatchingConfigInput } from '@amora/shared';
import { describe, expect, it } from 'vitest';
import { t } from '@/i18n';
import { bounds, dedupeMatrix, detailToForm, detailToInput, formToPayload, pairKey, weightSum } from './configForm';
import { detail } from './testFixtures';

describe('configForm', () => {
  it('converts the server detail (string numerics, mirrored matrix) into a valid contract input', () => {
    const input = detailToInput(detail());
    expect(adminMatchingConfigInput.safeParse(input).success).toBe(true);
    expect(input.minCompatibility).toBe(40);
    expect(input.importanceMultipliers).toEqual([0, 1, 2, 4]);
    expect(input.notes).toBe('tune values');
    expect(input.intentMatrix).toEqual([
      { a: 'casual', b: 'long_term', score: 0.2, hardExclusion: false },
      { a: 'long_term', b: 'long_term', score: 1, hardExclusion: false },
    ]);
  });

  it('round-trips form → payload without changes', () => {
    const d = detail();
    const { payload, errors } = formToPayload(detailToForm(d));
    expect(errors).toEqual({});
    expect(payload).toEqual(detailToInput(d));
  });

  it('omits empty weights and unconfigured pairs; hard exclusions without score send 0', () => {
    const f = detailToForm(detail(), ['serious']);
    expect(f.intents).toEqual(['casual', 'long_term', 'serious']);
    f.weights.lifestyle = undefined;
    f.intentCells[pairKey('serious', 'casual')] = { score: undefined, hardExclusion: true };
    f.intentCells[pairKey('serious', 'serious')] = { score: undefined, hardExclusion: false };
    const { payload, matrixKeys } = formToPayload(f);
    expect(payload.weights).toEqual({ values: 0.6 });
    expect(payload.intentMatrix).toContainEqual({ a: 'casual', b: 'serious', score: 0, hardExclusion: true });
    expect((payload.intentMatrix as unknown[]).length).toBe(3);
    expect(matrixKeys).toEqual(['casual|long_term', 'casual|serious', 'long_term|long_term']);
  });

  it('drops pairs whose intent was removed from the axis', () => {
    const f = detailToForm(detail());
    f.intents = ['long_term'];
    expect(formToPayload(f).payload.intentMatrix).toEqual([{ a: 'long_term', b: 'long_term', score: 1, hardExclusion: false }]);
  });

  it('flags duplicate rule keys and invalid builder conditions', () => {
    const f = detailToForm(detail());
    f.rankingRules = [f.rankingRules[0]!, { ...f.rankingRules[0]!, id: 'x', condition: { ok: false, error: 'missing_field' } }];
    const { errors } = formToPayload(f);
    expect(errors['rankingRules.1.key']).toBe(t('validation.duplicate', { value: 'verified_boost' }));
    expect(errors['rankingRules.1.condition']).toBe(t('matching.editor.rules.conditionInvalid'));
  });

  it('reads numeric bounds from the shared schema', () => {
    expect(bounds('minCompatibility')).toEqual({ min: 0, max: 100, step: 'any' });
    expect(bounds('candidatePoolLimit')).toEqual({ min: 10, max: 20000, step: 1 });
    expect(weightSum({ a: 0.5, b: undefined, c: 0.25 })).toBe(0.75);
    expect(dedupeMatrix([{ a: 'b', b: 'a', score: '0.3', hardExclusion: true }])).toEqual([{ a: 'a', b: 'b', score: 0.3, hardExclusion: true }]);
  });
});
