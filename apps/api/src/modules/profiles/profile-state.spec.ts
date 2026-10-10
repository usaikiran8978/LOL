import { completenessScore, DEFAULT_COMPLETENESS_WEIGHTS } from './profile-state.service';

const full = { hasDisplayName: true, hasBio: true, photos: 6, prompts: 3, interests: 10, identityFields: 3, hasWork: true, languages: 2, lifestyleAttributes: 5, questionnaireRatio: 1 };

describe('completenessScore', () => {
  it('default weights sum to 100', () => {
    expect(Object.values(DEFAULT_COMPLETENESS_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });
  it('is 100 for a full profile and 0 for an empty one', () => {
    expect(completenessScore(full)).toBe(100);
    expect(completenessScore({ hasDisplayName: false, hasBio: false, photos: 0, prompts: 0, interests: 0, identityFields: 0, hasWork: false, languages: 0, lifestyleAttributes: 0, questionnaireRatio: 0 })).toBe(0);
  });
  it('gives partial credit', () => {
    expect(completenessScore({ ...full, photos: 1 })).toBe(100 - Math.round(20 * (2 / 3)));
  });
});
