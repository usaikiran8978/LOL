/** Two-proportion z-test (pooled) — experiment significance for conversion metrics. Pure; unit-tested. */
export function twoProportionTest(convA: number, nA: number, convB: number, nB: number) {
  if (nA === 0 || nB === 0) return { lift: null, z: null, pValue: null, ci95: null };
  const pA = convA / nA, pB = convB / nB;
  const pooled = (convA + convB) / (nA + nB);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / nA + 1 / nB));
  const z = se === 0 ? 0 : (pB - pA) / se;
  const pValue = 2 * (1 - normalCdf(Math.abs(z)));
  const seDiff = Math.sqrt((pA * (1 - pA)) / nA + (pB * (1 - pB)) / nB);
  return { lift: pA === 0 ? null : (pB - pA) / pA, z, pValue, ci95: [pB - pA - 1.96 * seDiff, pB - pA + 1.96 * seDiff] as [number, number] };
}

/** Abramowitz–Stegun 7.1.26 approximation (error < 1.5e-7). */
export function normalCdf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

/** Stable bucket in [0, 10000) for (salt, user). */
export function bucket(salt: string, userId: string): number {
  // FNV-1a 32-bit: fast, deterministic, good enough dispersion for allocation.
  let h = 0x811c9dc5;
  for (const c of `${salt}:${userId}`) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 10_000;
}
