import { distanceBucket, geohashCenter, geohashEncode, geohashNeighborhood, haversineKm } from './geo';

describe('geo', () => {
  it('encodes known geohashes', () => {
    expect(geohashEncode(57.64911, 10.40744, 11)).toBe('u4pruydqqvj');
    const h = geohashEncode(17.385, 78.4867, 5);
    const c = geohashCenter(h);
    expect(Math.abs(c.lat - 17.385)).toBeLessThan(0.03);
    expect(Math.abs(c.lon - 78.4867)).toBeLessThan(0.03);
  });

  it('decodes to the cell centre within the cell size', () => {
    const c = geohashCenter('u4pruydqqvj');
    expect(Math.abs(c.lat - 57.64911)).toBeLessThan(0.0001);
    expect(Math.abs(c.lon - 10.40744)).toBeLessThan(0.0001);
  });

  it('returns 9 distinct neighbouring cells', () => {
    const n = geohashNeighborhood('u4pru');
    expect(new Set(n).size).toBe(9);
    expect(n).toEqual(expect.arrayContaining(['u4pru', 'u4prv', 'u4prg']));
  });

  it('computes haversine distance', () => {
    expect(haversineKm(51.5007, -0.1246, 40.6892, -74.0445)).toBeCloseTo(5574.8, 0);
  });

  it('buckets distances', () => {
    expect(distanceBucket(0.3)).toBe('lt_2km');
    expect(distanceBucket(7)).toBe('5_10km');
    expect(distanceBucket(400)).toBe('gt_100km');
  });
});
