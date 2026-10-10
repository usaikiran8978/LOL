import { bucket, normalCdf, twoProportionTest } from './stats';

describe('experiment statistics', () => {
  it('normal CDF matches known values', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
  });
  it('detects a significant difference and not a trivial one', () => {
    const sig = twoProportionTest(100, 1000, 150, 1000);
    expect(sig.pValue!).toBeLessThan(0.01);
    expect(sig.lift!).toBeCloseTo(0.5, 5);
    expect(twoProportionTest(100, 1000, 102, 1000).pValue!).toBeGreaterThan(0.5);
    expect(twoProportionTest(0, 0, 1, 1)).toEqual({ lift: null, z: null, pValue: null, ci95: null });
  });
  it('buckets deterministically and roughly uniformly', () => {
    expect(bucket('exp', 'u1')).toBe(bucket('exp', 'u1'));
    const under = Array.from({ length: 5000 }, (_, i) => bucket('exp', `user-${i}`)).filter((b) => b < 5000).length;
    expect(under).toBeGreaterThan(2300);
    expect(under).toBeLessThan(2700);
  });
});
