import type { DistanceBucket } from '@amora/shared';

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

/** Standard geohash encoding. Precision 5 ≈ 4.9 km cell, 6 ≈ 1.2 km, 7 ≈ 153 m. */
export function geohashEncode(lat: number, lon: number, precision: number): string {
  let latMin = -90, latMax = 90, lonMin = -180, lonMax = 180;
  let hash = '';
  let bit = 0, ch = 0, even = true;
  while (hash.length < precision) {
    if (even) {
      const mid = (lonMin + lonMax) / 2;
      if (lon >= mid) { ch = (ch << 1) | 1; lonMin = mid; } else { ch <<= 1; lonMax = mid; }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) { ch = (ch << 1) | 1; latMin = mid; } else { ch <<= 1; latMax = mid; }
    }
    even = !even;
    if (++bit === 5) { hash += BASE32[ch]; bit = 0; ch = 0; }
  }
  return hash;
}

/** Center of a geohash cell. Used so coarse locations never reveal more than the cell. */
export function geohashCenter(hash: string): { lat: number; lon: number } {
  let latMin = -90, latMax = 90, lonMin = -180, lonMax = 180, even = true;
  for (const c of hash) {
    const v = BASE32.indexOf(c);
    if (v < 0) throw new Error('invalid geohash');
    for (let b = 4; b >= 0; b--) {
      const bitSet = (v >> b) & 1;
      if (even) { const mid = (lonMin + lonMax) / 2; if (bitSet) lonMin = mid; else lonMax = mid; }
      else { const mid = (latMin + latMax) / 2; if (bitSet) latMin = mid; else latMax = mid; }
      even = !even;
    }
  }
  return { lat: (latMin + latMax) / 2, lon: (lonMin + lonMax) / 2 };
}

const NEIGHBOR = {
  n: ['p0r21436x8zb9dcf5h7kjnmqesgutwvy', 'bc01fg45238967deuvhjyznpkmstqrwx'],
  s: ['14365h7k9dcfesgujnmqp0r2twvyx8zb', '238967debc01fg45kmstqrwxuvhjyznp'],
  e: ['bc01fg45238967deuvhjyznpkmstqrwx', 'p0r21436x8zb9dcf5h7kjnmqesgutwvy'],
  w: ['238967debc01fg45kmstqrwxuvhjyznp', '14365h7k9dcfesgujnmqp0r2twvyx8zb'],
} as const;
const BORDER = {
  n: ['prxz', 'bcfguvyz'], s: ['028b', '0145hjnp'], e: ['bcfguvyz', 'prxz'], w: ['0145hjnp', '028b'],
} as const;

function adjacent(hash: string, dir: keyof typeof NEIGHBOR): string {
  const last = hash.slice(-1);
  let parent = hash.slice(0, -1);
  const type = hash.length % 2;
  if (BORDER[dir][type]!.includes(last) && parent) parent = adjacent(parent, dir);
  return parent + BASE32[NEIGHBOR[dir][type]!.indexOf(last)];
}

/** The cell plus its 8 neighbours — the candidate set for a "nearby" query at that precision. */
export function geohashNeighborhood(hash: string): string[] {
  const n = adjacent(hash, 'n'), s = adjacent(hash, 's');
  return [hash, n, s, adjacent(hash, 'e'), adjacent(hash, 'w'), adjacent(n, 'e'), adjacent(n, 'w'), adjacent(s, 'e'), adjacent(s, 'w')];
}

export function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** DEC-008: other users only ever see a bucket, never a precise distance. */
export function distanceBucket(km: number): DistanceBucket {
  if (km < 2) return 'lt_2km';
  if (km < 5) return '2_5km';
  if (km < 10) return '5_10km';
  if (km < 25) return '10_25km';
  if (km < 50) return '25_50km';
  if (km < 100) return '50_100km';
  return 'gt_100km';
}
