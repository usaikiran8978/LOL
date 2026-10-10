import { learnAffinities, personalizedScore } from './adaptive';

const sample = (positive: boolean, values: number, lifestyle: number) => ({ positive, weight: 1, categoryScores: { values, lifestyle } });

describe('adaptive matching', () => {
  it('learns that a user responds to values but not lifestyle', () => {
    const samples = [...Array.from({ length: 15 }, () => sample(true, 90, 50)), ...Array.from({ length: 15 }, () => sample(false, 40, 50))];
    const a = learnAffinities(samples);
    expect(a.values!.affinity).toBeGreaterThan(1.5);
    expect(a.lifestyle!.affinity).toBe(1);
  });
  it('needs enough data before personalising', () => {
    expect(learnAffinities([sample(true, 90, 50)])).toEqual({});
  });
  it('re-weights scores toward the categories the user cares about', () => {
    const scores = { values: 90, lifestyle: 30 };
    const w = { values: 0.5, lifestyle: 0.5 };
    expect(personalizedScore(scores, w, {})).toBe(60);
    expect(personalizedScore(scores, w, { values: 2, lifestyle: 0.5 })).toBe(78);
  });
});
