import { z } from 'zod';

/**
 * Predicate language used by user segments, feature-flag segment rules, question targeting, onboarding step
 * conditions and ranking rules. Evaluated server-side against a flat fact object; unknown fields evaluate to false.
 */
export type Predicate =
  | { all: Predicate[] }
  | { any: Predicate[] }
  | { not: Predicate }
  | { field: string; op: 'eq' | 'neq' | 'in' | 'nin' | 'gt' | 'gte' | 'lt' | 'lte' | 'exists' | 'contains'; value?: unknown };

export const predicate: z.ZodType<Predicate> = z.lazy(() =>
  z.union([
    z.object({ all: z.array(predicate).min(1).max(20) }),
    z.object({ any: z.array(predicate).min(1).max(20) }),
    z.object({ not: predicate }),
    z.object({
      field: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.]{0,63}$/),
      op: z.enum(['eq', 'neq', 'in', 'nin', 'gt', 'gte', 'lt', 'lte', 'exists', 'contains']),
      value: z.unknown().optional(),
    }),
  ]),
);

export type Facts = Record<string, unknown>;

function get(facts: Facts, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), facts);
}

export function evaluatePredicate(p: Predicate, facts: Facts, depth = 0): boolean {
  if (depth > 10) return false;
  if ('all' in p) return p.all.every((c) => evaluatePredicate(c, facts, depth + 1));
  if ('any' in p) return p.any.some((c) => evaluatePredicate(c, facts, depth + 1));
  if ('not' in p) return !evaluatePredicate(p.not, facts, depth + 1);
  const v = get(facts, p.field);
  switch (p.op) {
    case 'exists': return v !== undefined && v !== null;
    case 'eq': return v === p.value;
    case 'neq': return v !== p.value;
    case 'in': return Array.isArray(p.value) && p.value.includes(v);
    case 'nin': return Array.isArray(p.value) && !p.value.includes(v);
    case 'contains': return Array.isArray(v) && v.includes(p.value);
    case 'gt': return typeof v === 'number' && typeof p.value === 'number' && v > p.value;
    case 'gte': return typeof v === 'number' && typeof p.value === 'number' && v >= p.value;
    case 'lt': return typeof v === 'number' && typeof p.value === 'number' && v < p.value;
    case 'lte': return typeof v === 'number' && typeof p.value === 'number' && v <= p.value;
  }
}
