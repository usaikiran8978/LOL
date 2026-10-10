import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { predicate } from '@amora/shared';
import { DATABASE, type Database } from '../../common/db/database';
import { AppError } from '../../common/errors/app-error';
import { OutboxService } from '../../common/outbox/outbox.service';
import { QuestionRepo } from '../questionnaire/question-repo';
import type { EngineConfig, RuleDef } from './engine/compatibility';
import type { RankingConfig, RankingRule } from './engine/ranking';

export interface LoadedConfig {
  versionId: string;
  version: number;
  engine: EngineConfig;
  ranking: Omit<RankingConfig, 'limit'>;
  candidatePoolLimit: number;
  batchSize: number;
  dailyCuratedCount: number;
  repeatSuppressionDays: number;
  ttlHours: number;
  categoryLabels: Map<string, { id: string; key: string }>;
}

const CACHE_MS = 30_000;

/**
 * Turns the admin-managed matching config version (+ published questions/rules + intent matrix) into pure engine
 * input. Nothing here has business defaults: if no config is published, matching refuses to run.
 */
@Injectable()
export class MatchingConfigService implements OnModuleInit {
  private cache = new Map<string, { at: number; cfg: LoadedConfig }>();

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly questions: QuestionRepo,
    private readonly outbox: OutboxService,
  ) {}

  onModuleInit(): void {
    this.outbox.on('matching.config_changed', async () => this.invalidate());
  }

  invalidate(): void {
    this.cache.clear();
  }

  async publishedVersionId(): Promise<string> {
    const row = await this.db.selectFrom('matching_config_versions').select('id').where('status', '=', 'published').executeTakeFirst();
    if (!row) throw new AppError('INTERNAL', 'No published matching configuration');
    return row.id;
  }

  /** Config for a user: an experiment variant can route them to another version (P11 experiments). */
  async forUser(userId: string): Promise<LoadedConfig> {
    const variant = await this.db
      .selectFrom('experiment_assignments as a')
      .innerJoin('experiments as e', 'e.id', 'a.experiment_id')
      .innerJoin('experiment_variants as v', 'v.id', 'a.variant_id')
      .select(['v.config'])
      .where('a.user_id', '=', userId)
      .where('e.surface', '=', 'matching')
      .where('e.status', '=', 'running')
      .executeTakeFirst();
    const routed = (variant?.config as { matching_config_version_id?: string } | undefined)?.matching_config_version_id;
    return this.load(routed ?? (await this.publishedVersionId()));
  }

  async load(versionId: string): Promise<LoadedConfig> {
    const hit = this.cache.get(versionId);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.cfg;
    const v = await this.db.selectFrom('matching_config_versions').selectAll().where('id', '=', versionId).executeTakeFirst();
    if (!v) throw new AppError('NOT_FOUND', 'Matching config version not found');
    const [cats, weights, rules, intents, published] = await Promise.all([
      this.db.selectFrom('compatibility_categories').selectAll().where('is_active', '=', true).orderBy('position').execute(),
      this.db.selectFrom('matching_weights').selectAll().where('config_version_id', '=', versionId).execute(),
      this.db.selectFrom('ranking_rules').selectAll().where('config_version_id', '=', versionId).where('is_active', '=', true).orderBy('priority').execute(),
      this.db.selectFrom('intent_compatibility').selectAll().where('config_version_id', '=', versionId).execute(),
      this.questions.publishedQuestions(),
    ]);
    const weightOf = new Map(weights.map((w) => [w.compatibility_category_id, Number(w.weight)]));
    const engineRules: RuleDef[] = published.flatMap((q) =>
      q.version.rules.map((r) => ({
        sourceQuestionId: q.id, sourceOptionKey: r.sourceOptionKey, targetQuestionId: r.targetQuestionId, targetOptionKey: r.targetOptionKey,
        ruleType: r.ruleType as RuleDef['ruleType'], scoreDelta: r.scoreDelta, isExclusion: r.isExclusion, isBidirectional: r.isBidirectional,
      })),
    );
    const mult = (v.importance_multipliers as Array<number | string>).map(Number) as [number, number, number, number];
    const cfg: LoadedConfig = {
      versionId: v.id,
      version: v.version,
      engine: {
        categories: cats.map((c) => ({
          id: c.id, key: c.key, weight: weightOf.get(c.id) ?? 0, attributeKinds: c.attribute_kinds, usesIntent: c.uses_intent,
          usesInterests: c.uses_interests, usesLocation: c.uses_location, inOverall: c.in_overall,
        })),
        questions: published.map((q) => ({
          questionId: q.id, key: q.key, versionId: q.version.id, categoryId: q.version.compatibilityCategoryId ?? q.categoryCompatibilityId,
          weight: q.version.weight, isScored: q.version.isScored, optionValues: Object.fromEntries(q.version.options.map((o) => [o.key, o.numericValue])),
        })),
        rules: engineRules,
        intentMatrix: new Map(intents.flatMap((i) => [[`${i.intent_a_id}|${i.intent_b_id}`, { score: Number(i.score), hard: i.is_hard_exclusion }], [`${i.intent_b_id}|${i.intent_a_id}`, { score: Number(i.score), hard: i.is_hard_exclusion }]])),
        intentDefaultScore: Number(v.intent_default_score),
        importanceMultipliers: mult,
        defaultImportance: v.default_importance,
        missingAnswerPolicy: v.missing_answer_policy as EngineConfig['missingAnswerPolicy'],
        topFactorCount: v.top_factor_count,
        differenceThreshold: Number(v.difference_threshold),
      },
      ranking: {
        minCompatibility: Number(v.min_compatibility),
        minConfidence: Number(v.min_confidence),
        behavioralWeight: Number(v.behavioral_weight),
        safetyExcludeThreshold: Number(v.safety_exclude_threshold),
        safetyDownrankThreshold: Number(v.safety_downrank_threshold),
        safetyDownrankFactor: Number(v.safety_downrank_factor),
        rules: rules.flatMap((r): RankingRule[] => {
          const c = predicate.safeParse(r.condition);
          return c.success ? [{ key: r.key, ruleType: r.rule_type as RankingRule['ruleType'], condition: c.data, value: Number(r.value) }] : [];
        }),
        diversityMaxShare: Number(v.diversity_max_share),
        diversityDimensions: v.diversity_dimensions,
      },
      candidatePoolLimit: v.candidate_pool_limit,
      batchSize: v.recommendation_batch_size,
      dailyCuratedCount: v.daily_curated_count,
      repeatSuppressionDays: v.repeat_suppression_days,
      ttlHours: v.recommendation_ttl_hours,
      categoryLabels: new Map(cats.map((c) => [c.key, { id: c.id, key: c.key }])),
    };
    this.cache.set(versionId, { at: Date.now(), cfg });
    return cfg;
  }
}
