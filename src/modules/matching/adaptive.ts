/**
 * Adaptive matching (BRD §9 "continuous learning", appendix Phase 2). Pure helpers, unit-tested.
 *
 * Affinity per category = how much more a user's positive outcomes (likes, matches that led to good dates) scored on
 * that category than their passes did. Affinities personalise *ranking only*; the compatibility % shown to people
 * stays the symmetric, explainable engine score.
 */
export interface OutcomeSample {
  positive: boolean;
  weight: number;                          // e.g. 1 for a like, 3 for a positive date
  categoryScores: Record<string, number>;  // categoryKey → 0..100 at the time it was served
}

export function learnAffinities(samples: OutcomeSample[], opts = { minSamples: 20, strength: 1.5, min: 0.5, max: 2 }): Record<string, { affinity: number; n: number }> {
  if (samples.length < opts.minSamples) return {};
  const keys = new Set(samples.flatMap((s) => Object.keys(s.categoryScores)));
  const out: Record<string, { affinity: number; n: number }> = {};
  for (const k of keys) {
    const pos = samples.filter((s) => s.positive && k in s.categoryScores);
    const neg = samples.filter((s) => !s.positive && k in s.categoryScores);
    if (pos.length < 5 || neg.length < 5) continue;
    const mean = (xs: OutcomeSample[]) => xs.reduce((a, s) => a + s.categoryScores[k]! * s.weight, 0) / xs.reduce((a, s) => a + s.weight, 0);
    const diff = (mean(pos) - mean(neg)) / 100; // -1..1
    out[k] = { affinity: Math.max(opts.min, Math.min(opts.max, 1 + opts.strength * diff)), n: pos.length + neg.length };
  }
  return out;
}

/** Re-weights the engine's category scores with a user's affinities (0..100). */
export function personalizedScore(categoryScores: Record<string, number>, weights: Record<string, number>, affinities: Record<string, number>): number | null {
  let num = 0, den = 0;
  for (const [k, s] of Object.entries(categoryScores)) {
    const w = (weights[k] ?? 0) * (affinities[k] ?? 1);
    num += w * s;
    den += w;
  }
  return den ? Math.round((num / den) * 100) / 100 : null;
}
