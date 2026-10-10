import { evaluatePredicate, predicate } from './segments';

describe('predicates', () => {
  const facts = { countryCode: 'IN', age: 27, intents: ['long_term'], platform: 'ios', profile: { verified: true } };

  it('evaluates nested logic', () => {
    expect(evaluatePredicate({ all: [{ field: 'countryCode', op: 'in', value: ['IN', 'US'] }, { field: 'age', op: 'gte', value: 25 }] }, facts)).toBe(true);
    expect(evaluatePredicate({ any: [{ field: 'platform', op: 'eq', value: 'android' }, { field: 'profile.verified', op: 'eq', value: true }] }, facts)).toBe(true);
    expect(evaluatePredicate({ not: { field: 'intents', op: 'contains', value: 'long_term' } }, facts)).toBe(false);
  });

  it('treats unknown fields and type mismatches as false', () => {
    expect(evaluatePredicate({ field: 'missing', op: 'eq', value: 1 }, facts)).toBe(false);
    expect(evaluatePredicate({ field: 'countryCode', op: 'gt', value: 3 }, facts)).toBe(false);
  });

  it('rejects malformed predicates', () => {
    expect(predicate.safeParse({ field: 'x; drop', op: 'eq' }).success).toBe(false);
    expect(predicate.safeParse({ all: [] }).success).toBe(false);
  });
});
