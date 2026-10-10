import { Inject, Injectable } from '@nestjs/common';
import type { AdminMatchingConfigInput } from '@amora/shared';
import { sql } from 'kysely';
import { AuditService } from '../../common/audit/audit.service';
import { DATABASE, type Database, type Tx } from '../../common/db/database';
import { AppError } from '../../common/errors/app-error';
import type { ClientContext } from '../../common/http/request-context';
import { OutboxService } from '../../common/outbox/outbox.service';
import type { AdminContext } from '../admin/auth/admin-auth.service';
import { answerSimilarity, compatibility, eligibility, haversineKm, questionScore } from './engine/compatibility';
import { behaviorScore, rank } from './engine/ranking';
import { FeaturesService } from './features.service';
import { MatchingConfigService } from './matching-config.service';

const WEIGHT_TOLERANCE = 0.001;

/**
 * Admin control of the matching engine (MP §10): versioned configs (draft → validate → publish), category weights,
 * thresholds, diversity, safety, ranking rules, intent matrix — plus "Test Matching Rules" on two real users.
 */
@Injectable()
export class MatchingAdminService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly config: MatchingConfigService,
    private readonly features: FeaturesService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  list() {
    return this.db.selectFrom('matching_config_versions').select(['id', 'version', 'status', 'notes', 'created_at', 'published_at', 'published_by', 'created_by']).orderBy('version', 'desc').execute();
  }

  async get(id: string) {
    const v = await this.db.selectFrom('matching_config_versions').selectAll().where('id', '=', id).executeTakeFirst();
    if (!v) throw new AppError('NOT_FOUND');
    const [weights, rules, intents] = await Promise.all([
      this.db.selectFrom('matching_weights as w').innerJoin('compatibility_categories as c', 'c.id', 'w.compatibility_category_id').select(['c.key', 'w.weight']).where('w.config_version_id', '=', id).execute(),
      this.db.selectFrom('ranking_rules').selectAll().where('config_version_id', '=', id).orderBy('priority').execute(),
      this.db.selectFrom('intent_compatibility as i').innerJoin('taxonomy_terms as a', 'a.id', 'i.intent_a_id').innerJoin('taxonomy_terms as b', 'b.id', 'i.intent_b_id')
        .select(['a.key as a', 'b.key as b', 'i.score', 'i.is_hard_exclusion']).where('i.config_version_id', '=', id).execute(),
    ]);
    return {
      ...v,
      weights: Object.fromEntries(weights.map((w) => [w.key, Number(w.weight)])),
      rankingRules: rules.map((r) => ({ key: r.key, ruleType: r.rule_type, condition: r.condition, value: Number(r.value), isActive: r.is_active })),
      intentMatrix: intents.map((i) => ({ a: i.a, b: i.b, score: Number(i.score), hardExclusion: i.is_hard_exclusion })),
    };
  }

  /** Creates a draft from explicit input, or copies the published version when no input is given. */
  async createDraft(admin: AdminContext, client: ClientContext, input?: AdminMatchingConfigInput) {
    const existing = await this.db.selectFrom('matching_config_versions').select('id').where('status', '=', 'draft').executeTakeFirst();
    if (existing) throw new AppError('CONFLICT', 'A draft already exists', { draftId: existing.id });
    let content = input;
    if (!content) {
      // Copying needs something to copy: on a fresh install the first draft must be sent in full.
      const published = await this.db.selectFrom('matching_config_versions').select('id').where('status', '=', 'published').executeTakeFirst();
      if (!published) throw new AppError('VALIDATION_FAILED', 'No published configuration to copy; send a full configuration for the first draft');
      content = await this.toInput(published.id);
    }
    return this.db.transaction().execute(async (trx) => {
      const { v } = await trx.selectFrom('matching_config_versions').select(sql<number>`coalesce(max(version), 0) + 1`.as('v')).executeTakeFirstOrThrow();
      const row = await trx.insertInto('matching_config_versions').values({ version: v, status: 'draft', created_by: admin.adminId, ...this.columns(content) }).returning('id').executeTakeFirstOrThrow();
      await this.writeChildren(trx, row.id, content);
      await this.audit.record({ actorType: 'admin', actorId: admin.adminId, action: 'matching.draft_created', targetType: 'matching_config', targetId: row.id, client }, trx);
      return { id: row.id, version: v };
    });
  }

  async updateDraft(admin: AdminContext, client: ClientContext, id: string, input: AdminMatchingConfigInput) {
    const v = await this.db.selectFrom('matching_config_versions').select('status').where('id', '=', id).executeTakeFirst();
    if (!v) throw new AppError('NOT_FOUND');
    if (v.status !== 'draft') throw new AppError('VERSION_IMMUTABLE', 'Only drafts can be edited');
    const before = await this.get(id);
    await this.db.transaction().execute(async (trx) => {
      await trx.updateTable('matching_config_versions').set(this.columns(input)).where('id', '=', id).execute();
      await trx.deleteFrom('matching_weights').where('config_version_id', '=', id).execute();
      await trx.deleteFrom('ranking_rules').where('config_version_id', '=', id).execute();
      await trx.deleteFrom('intent_compatibility').where('config_version_id', '=', id).execute();
      await this.writeChildren(trx, id, input);
      await this.audit.record({ actorType: 'admin', actorId: admin.adminId, action: 'matching.draft_updated', targetType: 'matching_config', targetId: id, before: { weights: before.weights }, after: { weights: input.weights }, client }, trx);
    });
    return this.get(id);
  }

  async validate(id: string): Promise<Array<{ path: string; code: string; message: string }>> {
    const v = await this.get(id);
    const issues: Array<{ path: string; code: string; message: string }> = [];
    const sum = Object.values(v.weights).reduce((s, w) => s + w, 0);
    if (Math.abs(sum - 1) > WEIGHT_TOLERANCE) issues.push({ path: 'weights', code: 'weights_sum', message: `Category weights must sum to 1 (currently ${sum.toFixed(4)})` });
    if (Number(v.safety_downrank_threshold) > Number(v.safety_exclude_threshold)) issues.push({ path: 'safety', code: 'safety_order', message: 'Down-rank threshold must not exceed exclude threshold' });
    const mult = (v.importance_multipliers as Array<number | string>).map(Number);
    if (mult.some((m, i) => i > 0 && m < mult[i - 1]!)) issues.push({ path: 'importanceMultipliers', code: 'not_monotonic', message: 'Importance multipliers must not decrease with importance' });
    const cats = await this.db.selectFrom('compatibility_categories').select(['key', 'in_overall']).where('is_active', '=', true).execute();
    if (!cats.some((c) => c.in_overall && (v.weights[c.key] ?? 0) > 0)) issues.push({ path: 'weights', code: 'no_scoring_category', message: 'At least one scoring category needs weight' });
    return issues;
  }

  async publish(admin: AdminContext, client: ClientContext, id: string) {
    const v = await this.db.selectFrom('matching_config_versions').select('status').where('id', '=', id).executeTakeFirst();
    if (!v) throw new AppError('NOT_FOUND');
    if (v.status !== 'draft') throw new AppError('VERSION_IMMUTABLE', 'Only drafts can be published');
    const issues = await this.validate(id);
    if (issues.length) throw new AppError('PUBLISH_VALIDATION_FAILED', undefined, { issues });
    await this.db.transaction().execute(async (trx) => {
      const prev = await trx.selectFrom('matching_config_versions').select('id').where('status', '=', 'published').executeTakeFirst();
      if (prev) await trx.updateTable('matching_config_versions').set({ status: 'archived' }).where('id', '=', prev.id).execute();
      await trx.updateTable('matching_config_versions').set({ status: 'published', published_at: new Date(), published_by: admin.adminId }).where('id', '=', id).execute();
      await this.outbox.enqueue(trx, 'matching.config_changed', { reason: 'config_published', versionId: id });
      await this.audit.record({ actorType: 'admin', actorId: admin.adminId, action: 'matching.published', targetType: 'matching_config', targetId: id, before: { publishedVersionId: prev?.id ?? null }, client }, trx);
    });
    this.config.invalidate();
    return this.get(id);
  }

  async deleteDraft(admin: AdminContext, client: ClientContext, id: string) {
    const v = await this.db.selectFrom('matching_config_versions').select('status').where('id', '=', id).executeTakeFirst();
    if (!v) throw new AppError('NOT_FOUND');
    if (v.status !== 'draft') throw new AppError('VERSION_IMMUTABLE');
    await this.db.transaction().execute(async (trx) => {
      await trx.deleteFrom('matching_config_versions').where('id', '=', id).execute();
      await this.audit.record({ actorType: 'admin', actorId: admin.adminId, action: 'matching.draft_deleted', targetType: 'matching_config', targetId: id, client }, trx);
    });
  }

  async updateCategorySignals(admin: AdminContext, client: ClientContext, key: string, input: { attributeKinds: string[]; usesIntent: boolean; usesInterests: boolean; usesLocation: boolean; inOverall: boolean }) {
    const before = await this.db.selectFrom('compatibility_categories').selectAll().where('key', '=', key).executeTakeFirst();
    if (!before) throw new AppError('NOT_FOUND');
    await this.db.transaction().execute(async (trx) => {
      await trx.updateTable('compatibility_categories').set({ attribute_kinds: input.attributeKinds, uses_intent: input.usesIntent, uses_interests: input.usesInterests, uses_location: input.usesLocation, in_overall: input.inOverall }).where('key', '=', key).execute();
      await this.outbox.enqueue(trx, 'matching.config_changed', { reason: 'category_signals', key });
      await this.audit.record({ actorType: 'admin', actorId: admin.adminId, action: 'matching.category_signals_updated', targetType: 'compatibility_category', targetId: key, before, after: input, client }, trx);
    });
    this.config.invalidate();
  }

  /**
   * "Test Matching Rules" (MP §10): full breakdown for two real users under a chosen (or the published) config —
   * eligibility, per-category and per-question scores, rules that fired, deal-breakers and the ranking trace.
   * Access is audited as PII-adjacent data access.
   */
  async test(admin: AdminContext, client: ClientContext, userA: string, userB: string, configVersionId?: string) {
    const cfg = await this.config.load(configVersionId ?? (await this.config.publishedVersionId()));
    const loaded = await this.features.load([userA, userB]);
    const a = loaded.get(userA), b = loaded.get(userB);
    if (!a || !b) throw new AppError('NOT_FOUND', 'Both users need a profile');
    for (const uid of [userA, userB]) {
      await this.db.insertInto('admin_data_access_logs').values({ admin_user_id: admin.adminId, user_id: uid, resource: 'matching_features', purpose: 'matching.test' }).execute();
    }
    await this.audit.record({ actorType: 'admin', actorId: admin.adminId, action: 'matching.tested', targetType: 'user_pair', targetId: `${userA}:${userB}`, after: { configVersionId: cfg.versionId }, client });

    const distanceKm = a.features.location && b.features.location ? haversineKm(a.features.location, b.features.location) : null;
    const exclusion = eligibility(cfg.engine, a.features, b.features, distanceKm);
    const result = compatibility(cfg.engine, a.features, b.features);
    const questions = cfg.engine.questions.map((q) => {
      const qa = a.features.answers.get(q.questionId), qb = b.features.answers.get(q.questionId);
      const current = (x: typeof qa) => (x && x.versionId === q.versionId ? x : undefined);
      const ca = current(qa), cb = current(qb);
      return {
        questionKey: q.key, categoryId: q.categoryId, weight: q.weight,
        answeredA: !!qa, answeredB: !!qb, staleA: !!qa && !ca, staleB: !!qb && !cb,
        similarity: ca && cb ? answerSimilarity(q, ca.normalized, cb.normalized) : null,
        score: ca && cb ? questionScore(q, ca, cb) : null,
        importanceA: ca?.importance ?? null, importanceB: cb?.importance ?? null,
        dealbreakerA: ca?.isDealbreaker ?? false, dealbreakerB: cb?.isDealbreaker ?? false,
      };
    });
    const firedRules = cfg.engine.rules.filter((r) => {
      const keys = (u: typeof a, qid: string) => { const x = u.features.answers.get(qid); const n = x?.normalized; return n && (n.t === 'choice' || n.t === 'ranking') ? n.keys : x ? ['*'] : []; };
      const hit = (s: typeof a, t: typeof a) => keys(s, r.sourceQuestionId).length > 0 && keys(t, r.targetQuestionId).length > 0
        && (r.sourceOptionKey === null || keys(s, r.sourceQuestionId).includes(r.sourceOptionKey)) && (r.targetOptionKey === null || keys(t, r.targetQuestionId).includes(r.targetOptionKey));
      return hit(a, b) || (r.isBidirectional && hit(b, a));
    });
    const ranking = result.excluded ? null : rank([{ ...b.signals, compatibility: result.compatibility, confidence: result.confidence }], { ...cfg.ranking, limit: 1 });
    return {
      configVersion: cfg.version,
      configVersionId: cfg.versionId,
      eligible: !exclusion,
      exclusion,
      result,
      questions,
      positiveRules: firedRules.filter((r) => !r.isExclusion && ['positive', 'similarity'].includes(r.ruleType)),
      negativeRules: firedRules.filter((r) => !r.isExclusion && ['negative', 'distance'].includes(r.ruleType)),
      dealBreakers: firedRules.filter((r) => r.isExclusion || r.ruleType === 'dealbreaker'),
      ranking: ranking ? { finalScore: ranking.ranked[0]?.finalScore ?? null, appliedRules: ranking.ranked[0]?.appliedRules ?? [], dropped: ranking.dropped, behaviorScore: behaviorScore(b.signals.behavior), riskScore: b.signals.riskScore } : null,
    };
  }

  // ---------------------------------------------------------------------------------- internals

  private columns(i: AdminMatchingConfigInput) {
    return {
      min_compatibility: i.minCompatibility, candidate_pool_limit: i.candidatePoolLimit, recommendation_batch_size: i.recommendationBatchSize, daily_curated_count: i.dailyCuratedCount,
      behavioral_weight: i.behavioralWeight, diversity_max_share: i.diversityMaxShare, diversity_dimensions: i.diversityDimensions, repeat_suppression_days: i.repeatSuppressionDays,
      safety_exclude_threshold: i.safetyExcludeThreshold, safety_downrank_threshold: i.safetyDownrankThreshold, safety_downrank_factor: i.safetyDownrankFactor,
      missing_answer_policy: i.missingAnswerPolicy, importance_multipliers: i.importanceMultipliers, default_importance: i.defaultImportance, intent_default_score: i.intentDefaultScore,
      min_confidence: i.minConfidence, top_factor_count: i.topFactorCount, difference_threshold: i.differenceThreshold, recommendation_ttl_hours: i.recommendationTtlHours, notes: i.notes ?? null,
    };
  }

  private async writeChildren(trx: Tx, id: string, i: AdminMatchingConfigInput) {
    const cats = await trx.selectFrom('compatibility_categories').select(['id', 'key']).execute();
    const unknown = Object.keys(i.weights).filter((k) => !cats.some((c) => c.key === k));
    if (unknown.length) throw new AppError('VALIDATION_FAILED', `Unknown compatibility categories: ${unknown.join(', ')}`);
    const w = Object.entries(i.weights).map(([k, weight]) => ({ config_version_id: id, compatibility_category_id: cats.find((c) => c.key === k)!.id, weight }));
    if (w.length) await trx.insertInto('matching_weights').values(w).execute();
    if (i.rankingRules.length) {
      if (new Set(i.rankingRules.map((r) => r.key)).size !== i.rankingRules.length) throw new AppError('VALIDATION_FAILED', 'Duplicate ranking rule keys');
      await trx.insertInto('ranking_rules').values(i.rankingRules.map((r, p) => ({ config_version_id: id, key: r.key, rule_type: r.ruleType, condition: JSON.stringify(r.condition), value: r.value, priority: p, is_active: r.isActive }))).execute();
    }
    if (i.intentMatrix.length) {
      const intents = await trx.selectFrom('taxonomy_terms').select(['id', 'key']).where('kind', '=', 'dating_intent').execute();
      const idOf = (k: string) => intents.find((x) => x.key === k)?.id ?? (() => { throw new AppError('VALIDATION_FAILED', `Unknown intent ${k}`); })();
      const rows = new Map<string, { config_version_id: string; intent_a_id: string; intent_b_id: string; score: number; is_hard_exclusion: boolean }>();
      for (const m of i.intentMatrix) {
        const a = idOf(m.a), b = idOf(m.b);
        rows.set(`${a}|${b}`, { config_version_id: id, intent_a_id: a, intent_b_id: b, score: m.score, is_hard_exclusion: m.hardExclusion });
        rows.set(`${b}|${a}`, { config_version_id: id, intent_a_id: b, intent_b_id: a, score: m.score, is_hard_exclusion: m.hardExclusion });
      }
      await trx.insertInto('intent_compatibility').values([...rows.values()]).execute();
    }
  }

  private async toInput(id: string): Promise<AdminMatchingConfigInput> {
    const v = await this.get(id);
    return {
      minCompatibility: Number(v.min_compatibility), candidatePoolLimit: v.candidate_pool_limit, recommendationBatchSize: v.recommendation_batch_size, dailyCuratedCount: v.daily_curated_count,
      behavioralWeight: Number(v.behavioral_weight), diversityMaxShare: Number(v.diversity_max_share), diversityDimensions: v.diversity_dimensions as AdminMatchingConfigInput['diversityDimensions'],
      repeatSuppressionDays: v.repeat_suppression_days, safetyExcludeThreshold: Number(v.safety_exclude_threshold), safetyDownrankThreshold: Number(v.safety_downrank_threshold),
      safetyDownrankFactor: Number(v.safety_downrank_factor), missingAnswerPolicy: v.missing_answer_policy as AdminMatchingConfigInput['missingAnswerPolicy'],
      importanceMultipliers: (v.importance_multipliers as Array<number | string>).map(Number) as [number, number, number, number], defaultImportance: v.default_importance,
      intentDefaultScore: Number(v.intent_default_score), minConfidence: Number(v.min_confidence), topFactorCount: v.top_factor_count, differenceThreshold: Number(v.difference_threshold),
      recommendationTtlHours: v.recommendation_ttl_hours, notes: v.notes ?? undefined, weights: v.weights,
      rankingRules: v.rankingRules.map((r) => ({ key: r.key, ruleType: r.ruleType as 'boost' | 'penalty' | 'exclude', condition: r.condition as never, value: r.value, isActive: r.isActive })),
      intentMatrix: v.intentMatrix,
    };
  }
}
