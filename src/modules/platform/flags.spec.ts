import { compareVersions, rolloutBucket } from './flags.service';

describe('flag helpers', () => {
  it('assigns stable rollout buckets roughly uniformly', () => {
    expect(rolloutBucket('travel_mode', 'u1')).toBe(rolloutBucket('travel_mode', 'u1'));
    const counts = Array.from({ length: 2000 }, (_, i) => rolloutBucket('f', `user-${i}`)).filter((b) => b < 25).length;
    expect(counts).toBeGreaterThan(400);
    expect(counts).toBeLessThan(600);
  });

  it('compares semantic versions', () => {
    expect(compareVersions('1.10.0', '1.9.3')).toBe(1);
    expect(compareVersions('2.0', '2.0.0')).toBe(0);
    expect(compareVersions('1.2.3', '1.3')).toBe(-1);
  });
});
