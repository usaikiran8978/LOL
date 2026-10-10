/**
 * Ranking stage (TECH §6: behavioral ranking → safety/risk filtering → diversity/fairness → final). Pure.
 * Compatibility answers "how well do these two fit"; ranking decides "what to show first", blending in behavior
 * signals that predict meaningful outcomes (replies, dates, positive feedback) — not raw likes (MP §7).
 */
import { evaluatePredicate, type Predicate } from '@amora/shared';

export interface CandidateSignals {
  candidateId: string;
  compatibility: number;   // 0..100
  confidence: number;      // 0..1
  riskScore: number;       // 0..1 internal; never exposed
  behavior: {
    replyRate: number | null;            // 0..1
    positiveFeedbackRate: number | null; // 0..1 (post-date feedback)
    recommendationAcceptRate: number | null;
    activeWithinDays: number | null;
  };
  facts: Record<string, unknown>;        // for ranking-rule predicates (verified, hasBio, photoCount, boosted ...)
  diversityBuckets: Record<string, string>; // dimension → bucket (age_band, intent, city ...)
}

export interface RankingRule {
  key: string;
  ruleType: 'boost' | 'penalty' | 'exclude';
  condition: Predicate;
  value: number; // boost/penalty magnitude 0..1
}

export interface RankingConfig {
  minCompatibility: number;
  minConfidence: number;
  behavioralWeight: number;
  safetyExcludeThreshold: number;
  safetyDownrankThreshold: number;
  safetyDownrankFactor: number;
  rules: RankingRule[];
  diversityMaxShare: number;
  diversityDimensions: string[];
  limit: number;
}

export interface RankedCandidate {
  candidateId: string;
  finalScore: number;
  compatibility: number;
  confidence: number;
  appliedRules: string[];
}

export interface RankingTrace {
  ranked: RankedCandidate[];
  dropped: Array<{ candidateId: string; reason: string }>;
}

/** Outcome-oriented behavior score; recency matters, but replying and good dates matter more. */
export function behaviorScore(b: CandidateSignals['behavior']): number {
  const parts: Array<[number | null, number]> = [
    [b.replyRate, 0.35],
    [b.positiveFeedbackRate, 0.35],
    [b.recommendationAcceptRate, 0.1],
    [b.activeWithinDays === null ? null : Math.max(0, 1 - b.activeWithinDays / 30), 0.2],
  ];
  const present = parts.filter(([v]) => v !== null) as Array<[number, number]>;
  if (!present.length) return 0.5; // new users: neutral, so they are not starved of exposure
  const w = present.reduce((s, [, x]) => s + x, 0);
  return present.reduce((s, [v, x]) => s + v * x, 0) / w;
}

export function rank(candidates: CandidateSignals[], cfg: RankingConfig): RankingTrace {
  const dropped: RankingTrace['dropped'] = [];
  const scored: Array<RankedCandidate & { buckets: Record<string, string> }> = [];

  for (const c of candidates) {
    if (c.compatibility < cfg.minCompatibility) { dropped.push({ candidateId: c.candidateId, reason: 'below_min_compatibility' }); continue; }
    if (c.riskScore >= cfg.safetyExcludeThreshold) { dropped.push({ candidateId: c.candidateId, reason: 'safety_excluded' }); continue; }

    let score = (c.compatibility / 100) * (1 - cfg.behavioralWeight) + behaviorScore(c.behavior) * cfg.behavioralWeight;
    if (c.confidence < cfg.minConfidence) score *= 0.5 + 0.5 * (c.confidence / Math.max(cfg.minConfidence, 1e-9));
    const applied: string[] = [];
    let excludedBy: string | null = null;
    for (const r of cfg.rules) {
      if (!evaluatePredicate(r.condition, c.facts)) continue;
      applied.push(r.key);
      if (r.ruleType === 'exclude') { excludedBy = r.key; break; }
      score *= r.ruleType === 'boost' ? 1 + r.value : 1 - r.value;
    }
    if (excludedBy) { dropped.push({ candidateId: c.candidateId, reason: `rule:${excludedBy}` }); continue; }
    if (c.riskScore >= cfg.safetyDownrankThreshold) { score *= cfg.safetyDownrankFactor; applied.push('safety_downrank'); }
    scored.push({ candidateId: c.candidateId, finalScore: Math.round(score * 1e6) / 1e6, compatibility: c.compatibility, confidence: c.confidence, appliedRules: applied, buckets: c.diversityBuckets });
  }

  // Deterministic order: score desc, then id.
  scored.sort((x, y) => y.finalScore - x.finalScore || x.candidateId.localeCompare(y.candidateId));

  // Greedy diversity: no bucket in any dimension may exceed maxShare of the batch, unless nothing else is left.
  const out: typeof scored = [];
  const deferred: typeof scored = [];
  const maxPerBucket = Math.max(1, Math.floor(cfg.limit * cfg.diversityMaxShare));
  const counts = new Map<string, number>();
  const key = (d: string, b: string) => `${d}:${b}`;
  for (const c of scored) {
    if (out.length >= cfg.limit) break;
    const over = cfg.diversityMaxShare < 1 && cfg.diversityDimensions.some((d) => c.buckets[d] !== undefined && (counts.get(key(d, c.buckets[d]!)) ?? 0) >= maxPerBucket);
    if (over) { deferred.push(c); continue; }
    out.push(c);
    for (const d of cfg.diversityDimensions) if (c.buckets[d] !== undefined) counts.set(key(d, c.buckets[d]!), (counts.get(key(d, c.buckets[d]!)) ?? 0) + 1);
  }
  for (const c of deferred) if (out.length < cfg.limit) out.push(c);
  return { ranked: out.map(({ buckets: _b, ...r }) => r), dropped };
}
