import type { AiUsageRow } from '@/lib/api/modules/ai';
import { toNumber } from './shared';

export interface UsageTotals {
  requests: number;
  succeeded: number;
  fallbacks: number;
  blocked: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

const empty = (): UsageTotals => ({ requests: 0, succeeded: 0, fallbacks: 0, blocked: 0, inputTokens: 0, outputTokens: 0, cost: 0 });

function add(acc: UsageTotals, r: AiUsageRow): UsageTotals {
  acc.requests += r.requests;
  acc.succeeded += r.succeeded;
  acc.fallbacks += r.fallbacks;
  acc.blocked += r.blocked;
  acc.inputTokens += r.input_tokens;
  acc.outputTokens += r.output_tokens;
  acc.cost += toNumber(r.cost_usd) ?? 0;
  return acc;
}

export function totals(rows: AiUsageRow[]): UsageTotals {
  return rows.reduce(add, empty());
}

/** Sums rows by a key (feature or day), preserving first-seen order. */
export function groupBy(rows: AiUsageRow[], key: (r: AiUsageRow) => string): Array<{ key: string; totals: UsageTotals }> {
  const map = new Map<string, UsageTotals>();
  for (const r of rows) {
    const k = key(r);
    map.set(k, add(map.get(k) ?? empty(), r));
  }
  return [...map.entries()].map(([k, v]) => ({ key: k, totals: v }));
}
