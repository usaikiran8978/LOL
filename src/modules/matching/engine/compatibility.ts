/**
 * Compatibility engine — pure and deterministic (TECH §6–7, §20 "matching-engine deterministic tests").
 * No I/O, no clock, no randomness: given the same config + features it always returns the same result.
 *
 * Overall compatibility = Σ(w_c · s_c) / Σ(w_c) over categories that have signal for this pair, where every
 * category weight w_c comes from the published matching config (admin-managed) and each category score s_c is a
 * weighted mean of its signals (questionnaire answers, profile attributes, intent, interests, location).
 */
import type { Normalized } from '../../questionnaire/answers';

// ------------------------------------------------------------------------------------------------ types

export interface CategoryDef {
  id: string;
  key: string;
  weight: number;            // from matching_weights; 0 = ignored
  attributeKinds: string[];
  usesIntent: boolean;
  usesInterests: boolean;
  usesLocation: boolean;
  inOverall: boolean;
}

export interface RuleDef {
  sourceQuestionId: string;
  sourceOptionKey: string | null; // null = any answer
  targetQuestionId: string;
  targetOptionKey: string | null; // null = any answer
  ruleType: 'positive' | 'negative' | 'dealbreaker' | 'similarity' | 'distance';
  scoreDelta: number;
  isExclusion: boolean;
  isBidirectional: boolean;
}

export interface QuestionDef {
  questionId: string;
  key: string;
  versionId: string;          // published version — only answers to this version are compared
  categoryId: string | null;
  weight: number;
  isScored: boolean;
  optionValues: Record<string, number | null>; // option key → numeric value (ordinal options)
}

export interface EngineConfig {
  categories: CategoryDef[];
  questions: QuestionDef[];
  rules: RuleDef[];
  intentMatrix: Map<string, { score: number; hard: boolean }>; // `${a}|${b}` (both orders present)
  intentDefaultScore: number;
  importanceMultipliers: [number, number, number, number];
  defaultImportance: number;
  missingAnswerPolicy: 'neutral' | 'penalize' | 'ignore';
  topFactorCount: number;
  differenceThreshold: number;
}

export interface AnswerFeature {
  versionId: string;
  normalized: Normalized;
  importance: number | null;
  isDealbreaker: boolean;
}

export interface UserFeatures {
  userId: string;
  age: number | null;
  genderTermId: string | null;
  intentTermId: string | null;
  goalTermId: string | null;
  verified: boolean;
  attributes: Map<string, string[]>;  // kind → term ids
  interests: Set<string>;
  location: { lat: number; lon: number } | null;
  answers: Map<string, AnswerFeature>; // questionId → answer
  prefs: {
    ageMin: number;
    ageMax: number;
    ageStrict: boolean;
    maxDistanceKm: number;
    distanceStrict: boolean;
    globalMode: boolean;
    verifiedOnly: boolean;
    genderTermIds: string[];             // empty = open to all
    intentTermIds: string[];
    dealbreakerTerms: Map<string, string[]>; // kind → accepted term ids (hard filter)
  };
}

export interface Factor {
  categoryKey: string;
  score: number;        // 0..100
  reasonKey: string;    // i18n key, e.g. match.reason.values
  params: Record<string, string | number>;
}

export interface CompatibilityResult {
  excluded: false;
  compatibility: number;                // 0..100, shown to users
  confidence: number;                   // 0..1
  categoryScores: Record<string, number>; // categoryKey → 0..100 (only categories with signal)
  topFactors: Factor[];
  differences: Factor[];
  sharedInterestIds: string[];
  distanceKm: number | null;            // internal; callers must bucket before exposing (DEC-008)
}

export interface Exclusion {
  excluded: true;
  reason: string; // machine reason — admin "Test Matching Rules" shows it; never sent to end users
  detail?: Record<string, unknown>;
}

// ------------------------------------------------------------------------------------------------ helpers

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const round2 = (x: number) => Math.round(x * 100) / 100;

export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function keysOf(n: Normalized): string[] {
  return n.t === 'choice' || n.t === 'ranking' ? n.keys : [];
}

/** Similarity of two answers to the same question version, ignoring acceptable-answer preferences. */
export function answerSimilarity(q: QuestionDef, a: Normalized, b: Normalized): number | null {
  if (a.t !== b.t) return null;
  switch (a.t) {
    case 'choice': {
      const bk = (b as typeof a).keys;
      const nums = (keys: string[]) => keys.map((k) => q.optionValues[k]).filter((v): v is number => typeof v === 'number');
      const na = nums(a.keys), nb = nums(bk);
      const all = Object.values(q.optionValues).filter((v): v is number => typeof v === 'number');
      if (na.length === a.keys.length && nb.length === bk.length && all.length >= 2) {
        const range = Math.max(...all) - Math.min(...all) || 1;
        const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
        return clamp01(1 - Math.abs(mean(na) - mean(nb)) / range);
      }
      const inter = a.keys.filter((k) => bk.includes(k)).length;
      const union = new Set([...a.keys, ...bk]).size;
      return union ? inter / union : null;
    }
    case 'scale':
      return clamp01(1 - Math.abs(a.ratio - (b as typeof a).ratio));
    case 'range': {
      const bb = b as typeof a;
      const overlap = Math.max(0, Math.min(a.max, bb.max) - Math.max(a.min, bb.min));
      const union = Math.max(a.max, bb.max) - Math.min(a.min, bb.min);
      return union === 0 ? 1 : overlap / union;
    }
    case 'ranking': {
      const bk = (b as typeof a).keys;
      const keys = [...new Set([...a.keys, ...bk])];
      const n = keys.length;
      if (n < 2) return 1;
      const pos = (list: string[], k: string) => (list.includes(k) ? list.indexOf(k) : n);
      const footrule = keys.reduce((s, k) => s + Math.abs(pos(a.keys, k) - pos(bk, k)), 0);
      const max = Math.floor((n * n) / 2) + n; // includes the "missing" position penalty
      return clamp01(1 - footrule / max);
    }
    case 'text':
      return null;
  }
}

/**
 * Question-level score for a pair: mutual acceptability when either side stated acceptable answers, otherwise
 * similarity. Returns null when the question can't be compared (e.g. free text).
 */
export function questionScore(q: QuestionDef, a: AnswerFeature, b: AnswerFeature): number | null {
  const sat: number[] = [];
  if (a.normalized.t === 'choice' && a.normalized.acceptable?.length) sat.push(keysOf(b.normalized).some((k) => a.normalized.t === 'choice' && a.normalized.acceptable!.includes(k)) ? 1 : 0);
  if (b.normalized.t === 'choice' && b.normalized.acceptable?.length) sat.push(keysOf(a.normalized).some((k) => b.normalized.t === 'choice' && b.normalized.acceptable!.includes(k)) ? 1 : 0);
  if (sat.length) return sat.reduce((s, x) => s + x, 0) / sat.length;
  return answerSimilarity(q, a.normalized, b.normalized);
}

function ruleFires(rule: RuleDef, src: AnswerFeature | undefined, tgt: AnswerFeature | undefined): boolean {
  if (!src || !tgt) return false;
  const srcOk = rule.sourceOptionKey === null || keysOf(src.normalized).includes(rule.sourceOptionKey);
  const tgtOk = rule.targetOptionKey === null || keysOf(tgt.normalized).includes(rule.targetOptionKey);
  return srcOk && tgtOk;
}

// ------------------------------------------------------------------------------------------------ eligibility

/** Hard filters in one direction: does `seeker` accept `candidate`? (TECH §6 eligibility + deal-breakers) */
function acceptsOneWay(cfg: EngineConfig, seeker: UserFeatures, candidate: UserFeatures, distanceKm: number | null): Exclusion | null {
  const p = seeker.prefs;
  if (candidate.age !== null && p.ageStrict && (candidate.age < p.ageMin || candidate.age > p.ageMax)) return { excluded: true, reason: 'age_preference', detail: { seeker: seeker.userId } };
  if (p.genderTermIds.length && (!candidate.genderTermId || !p.genderTermIds.includes(candidate.genderTermId))) return { excluded: true, reason: 'gender_preference', detail: { seeker: seeker.userId } };
  if (p.intentTermIds.length && candidate.intentTermId && !p.intentTermIds.includes(candidate.intentTermId)) return { excluded: true, reason: 'intent_preference', detail: { seeker: seeker.userId } };
  if (p.verifiedOnly && !candidate.verified) return { excluded: true, reason: 'verified_only', detail: { seeker: seeker.userId } };
  if (!p.globalMode && p.distanceStrict && distanceKm !== null && distanceKm > p.maxDistanceKm) return { excluded: true, reason: 'distance_preference', detail: { seeker: seeker.userId } };
  for (const [kind, accepted] of p.dealbreakerTerms) {
    const has = candidate.attributes.get(kind) ?? [];
    // Unanswered attributes do not trigger a deal-breaker; conflicting ones do.
    if (has.length && !has.some((t) => accepted.includes(t))) return { excluded: true, reason: 'attribute_dealbreaker', detail: { seeker: seeker.userId, kind } };
  }
  for (const q of cfg.questions) {
    const mine = seeker.answers.get(q.questionId);
    const theirs = candidate.answers.get(q.questionId);
    if (!mine?.isDealbreaker || mine.versionId !== q.versionId || !theirs || theirs.versionId !== q.versionId) continue;
    if (mine.normalized.t === 'choice' && mine.normalized.acceptable?.length) {
      const acc = mine.normalized.acceptable;
      if (!keysOf(theirs.normalized).some((k) => acc.includes(k))) return { excluded: true, reason: 'question_dealbreaker', detail: { seeker: seeker.userId, question: q.key } };
    }
  }
  return null;
}

export function eligibility(cfg: EngineConfig, a: UserFeatures, b: UserFeatures, distanceKm: number | null): Exclusion | null {
  if (a.userId === b.userId) return { excluded: true, reason: 'self' };
  const ex = acceptsOneWay(cfg, a, b, distanceKm) ?? acceptsOneWay(cfg, b, a, distanceKm);
  if (ex) return ex;
  if (a.intentTermId && b.intentTermId) {
    const m = cfg.intentMatrix.get(`${a.intentTermId}|${b.intentTermId}`);
    if (m?.hard) return { excluded: true, reason: 'intent_incompatible' };
  }
  // Admin exclusion rules: "if A answered X then never show people who answered Y".
  const qv = new Map(cfg.questions.map((q) => [q.questionId, q.versionId]));
  const current = (u: UserFeatures, qid: string) => {
    const ans = u.answers.get(qid);
    return ans && ans.versionId === qv.get(qid) ? ans : undefined;
  };
  for (const r of cfg.rules) {
    if (!(r.isExclusion || r.ruleType === 'dealbreaker')) continue;
    const fwd = ruleFires(r, current(a, r.sourceQuestionId), current(b, r.targetQuestionId));
    const back = r.isBidirectional && ruleFires(r, current(b, r.sourceQuestionId), current(a, r.targetQuestionId));
    if (fwd || back) return { excluded: true, reason: 'exclusion_rule', detail: { sourceQuestionId: r.sourceQuestionId, targetQuestionId: r.targetQuestionId } };
  }
  return null;
}

// ------------------------------------------------------------------------------------------------ scoring

export function compatibility(cfg: EngineConfig, a: UserFeatures, b: UserFeatures): CompatibilityResult | Exclusion {
  const distanceKm = a.location && b.location ? haversineKm(a.location, b.location) : null;
  const ex = eligibility(cfg, a, b, distanceKm);
  if (ex) return ex;

  const imp = (i: number | null) => cfg.importanceMultipliers[i ?? cfg.defaultImportance] ?? 1;
  const qByCategory = new Map<string, QuestionDef[]>();
  for (const q of cfg.questions) if (q.categoryId && q.isScored) qByCategory.set(q.categoryId, [...(qByCategory.get(q.categoryId) ?? []), q]);

  // Pairwise rule adjustments per source question (positive/negative boosts, clamped later).
  const ruleDelta = new Map<string, number>();
  const qv = new Map(cfg.questions.map((q) => [q.questionId, q.versionId]));
  const cur = (u: UserFeatures, qid: string) => {
    const ans = u.answers.get(qid);
    return ans && ans.versionId === qv.get(qid) ? ans : undefined;
  };
  for (const r of cfg.rules) {
    if (r.isExclusion || r.ruleType === 'dealbreaker') continue;
    const sign = r.ruleType === 'negative' || r.ruleType === 'distance' ? -Math.abs(r.scoreDelta) : Math.abs(r.scoreDelta);
    let fired = 0;
    if (ruleFires(r, cur(a, r.sourceQuestionId), cur(b, r.targetQuestionId))) fired++;
    if (r.isBidirectional && ruleFires(r, cur(b, r.sourceQuestionId), cur(a, r.targetQuestionId))) fired++;
    if (fired) ruleDelta.set(r.sourceQuestionId, (ruleDelta.get(r.sourceQuestionId) ?? 0) + sign * Math.min(fired, 1));
  }

  const categoryScores: Record<string, number> = {};
  const contributions: Array<{ cat: CategoryDef; score: number; params: Record<string, string | number> }> = [];
  let weightAvailable = 0;
  let weightTotal = 0;
  let weightedSum = 0;
  let questionsCompared = 0;
  let questionsPossible = 0;
  const shared = [...a.interests].filter((i) => b.interests.has(i));

  for (const cat of cfg.categories) {
    if (cat.weight <= 0) continue;
    const signals: Array<{ s: number; w: number }> = [];
    const params: Record<string, string | number> = {};

    // Questionnaire answers mapped to this category.
    const qs = qByCategory.get(cat.id) ?? [];
    let agreed = 0;
    for (const q of qs) {
      questionsPossible++;
      const qa = cur(a, q.questionId);
      const qb = cur(b, q.questionId);
      if (!qa || !qb) {
        if (cfg.missingAnswerPolicy === 'penalize' && (qa || qb)) signals.push({ s: 0.5, w: q.weight * 0.5 });
        continue;
      }
      let s = questionScore(q, qa, qb);
      if (s === null) continue;
      s = clamp01(s + (ruleDelta.get(q.questionId) ?? 0));
      const w = q.weight * ((imp(qa.importance) + imp(qb.importance)) / 2);
      if (w <= 0) continue;
      questionsCompared++;
      if (s >= 0.75) agreed++;
      signals.push({ s, w });
    }
    if (agreed) params.agreedAnswers = agreed;

    for (const kind of cat.attributeKinds) {
      const ta = a.attributes.get(kind) ?? [];
      const tb = b.attributes.get(kind) ?? [];
      if (!ta.length || !tb.length) continue;
      const inter = ta.filter((t) => tb.includes(t)).length;
      signals.push({ s: inter / new Set([...ta, ...tb]).size, w: 1 });
    }

    if (cat.usesIntent && a.intentTermId && b.intentTermId) {
      const m = cfg.intentMatrix.get(`${a.intentTermId}|${b.intentTermId}`);
      const s = a.intentTermId === b.intentTermId ? 1 : (m?.score ?? cfg.intentDefaultScore);
      signals.push({ s, w: 2 });
      if (a.goalTermId && b.goalTermId) signals.push({ s: a.goalTermId === b.goalTermId ? 1 : 0.4, w: 1 });
      if (a.intentTermId === b.intentTermId) params.sameIntent = 1;
    }

    if (cat.usesInterests && a.interests.size && b.interests.size) {
      signals.push({ s: Math.min(1, shared.length / Math.max(1, Math.min(3, Math.min(a.interests.size, b.interests.size)))), w: 1 });
      params.sharedInterests = shared.length;
    }

    if (cat.usesLocation && distanceKm !== null && !(a.prefs.globalMode && b.prefs.globalMode)) {
      const horizon = Math.max(1, Math.max(a.prefs.maxDistanceKm, b.prefs.maxDistanceKm));
      signals.push({ s: clamp01(1 - distanceKm / horizon), w: 1 });
    }

    if (cat.inOverall) weightTotal += cat.weight;
    if (!signals.length) continue;
    const sw = signals.reduce((s, x) => s + x.w, 0);
    const score = signals.reduce((s, x) => s + x.s * x.w, 0) / sw;
    categoryScores[cat.key] = round2(score * 100);
    if (cat.inOverall) {
      weightAvailable += cat.weight;
      weightedSum += cat.weight * score;
      contributions.push({ cat, score, params });
    }
  }

  const overall = weightAvailable ? weightedSum / weightAvailable : 0;
  const coverage = weightTotal ? weightAvailable / weightTotal : 0;
  const answerCoverage = questionsPossible ? questionsCompared / questionsPossible : 1;
  const confidence = round2(clamp01(coverage * (0.5 + 0.5 * answerCoverage)) * 100) / 100;

  const ranked = [...contributions].sort((x, y) => y.cat.weight * y.score - x.cat.weight * x.score || x.cat.key.localeCompare(y.cat.key));
  const topFactors = ranked
    .filter((c) => c.score >= cfg.differenceThreshold)
    .slice(0, cfg.topFactorCount)
    .map((c) => ({ categoryKey: c.cat.key, score: round2(c.score * 100), reasonKey: `match.reason.${c.cat.key}`, params: c.params }));
  const differences = contributions
    .filter((c) => c.score < cfg.differenceThreshold)
    .sort((x, y) => x.score - y.score || x.cat.key.localeCompare(y.cat.key))
    .map((c) => ({ categoryKey: c.cat.key, score: round2(c.score * 100), reasonKey: `match.difference.${c.cat.key}`, params: c.params }));

  return {
    excluded: false,
    compatibility: round2(overall * 100),
    confidence,
    categoryScores,
    topFactors,
    differences,
    sharedInterestIds: shared.sort(),
    distanceKm,
  };
}
