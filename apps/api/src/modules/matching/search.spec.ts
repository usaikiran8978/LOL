import { openSearchQuery } from './search';

describe('openSearchQuery', () => {
  it('maps filters to a bool filter query with keyset pagination', () => {
    const q = openSearchQuery({ viewerId: 'me', genderIds: ['g1'], verifiedOnly: true, interestIds: ['i1'], originGeohash: 'tepfb', radiusKm: 10, limit: 20, after: { lastActive: '2026-01-01T00:00:00.000Z', id: 'x' } }) as any;
    const filters = JSON.stringify(q.query.bool.filter);
    expect(filters).toContain('"genderId":["g1"]');
    expect(filters).toContain('"verified":true');
    expect(filters).toContain('"prefix":{"geohash5":"tepfb"}');
    expect(q.query.bool.must_not).toEqual([{ term: { id: 'me' } }]);
    expect(q.search_after).toEqual(['2026-01-01T00:00:00.000Z', 'x']);
    expect(q.size).toBe(20);
  });
});
