import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { AnalyticsService } from '../../common/analytics/analytics.service';
import { AuditService } from '../../common/audit/audit.service';
import { DATABASE, type Database } from '../../common/db/database';
import { AppError } from '../../common/errors/app-error';
import { FlagsService } from '../platform/flags.service';
import { UserFactsService } from '../platform/user-facts.service';
import { bucket, twoProportionTest } from './stats';

export interface ExperimentInput {
  key: string;
  surface: 'matching' | 'profile_layout' | 'onboarding' | 'questionnaire' | 'paywall' | 'discovery' | 'ai' | 'notifications' | 'other';
  hypothesis?: string;
  segmentKey?: string | null;
  trafficPct: number;
  primaryMetric: string; // analytics event name counted as conversion after assignment
  variants: Array<{ key: string; allocation: number; isControl: boolean; config: Record<string, unknown> }>;
}

/**
 * A/B experiments (BRD §19, MP §28). Assignment is deterministic (hash of experiment key + user) so it is stable without
 * a lookup, but is also persisted on first exposure for analysis. Segment and traffic gates apply before allocation.
 */
@Injectable()
export class ExperimentsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly facts: UserFactsService,
    private readonly flags: FlagsService,
    private readonly analytics: AnalyticsService,
    private readonly audit: AuditService,
  ) {}

  /** Variants for all running experiments on the given surfaces (used by /v1/config and server features). */
  async assignments(userId: string, surfaces?: string[]): Promise<Record<string, { variant: string; config: Record<string, unknown> }>> {
    let qb = this.db.selectFrom('experiments as e').leftJoin('user_segments as s', 's.id', 'e.segment_id').select(['e.id', 'e.key', 'e.traffic_pct', 's.definition']).where('e.status', '=', 'running');
    if (surfaces?.length) qb = qb.where('e.surface', 'in', surfaces);
    const exps = await qb.execute();
    if (!exps.length) return {};
    const facts = await this.facts.load(userId);
    const variants = await this.db.selectFrom('experiment_variants').selectAll().where('experiment_id', 'in', exps.map((e) => e.id)).orderBy('key').execute();
    const existing = await this.db.selectFrom('experiment_assignments').select(['experiment_id', 'variant_id']).where('user_id', '=', userId).where('experiment_id', 'in', exps.map((e) => e.id)).execute();
    const out: Record<string, { variant: string; config: Record<string, unknown> }> = {};
    for (const e of exps) {
      const vs = variants.filter((v) => v.experiment_id === e.id);
      const prior = existing.find((x) => x.experiment_id === e.id);
      let chosen = prior ? vs.find((v) => v.id === prior.variant_id) : undefined;
      if (!chosen) {
        if (e.definition && !this.flags.segmentMatches(e.definition, facts)) continue;
        if (bucket(`${e.key}:traffic`, userId) >= e.traffic_pct * 100) continue;
        const b = bucket(e.key, userId) / 100; // 0..100
        let acc = 0;
        chosen = vs.find((v) => (acc += v.allocation) > b) ?? vs.at(-1);
        if (!chosen) continue;
        const inserted = await this.db.insertInto('experiment_assignments').values({ experiment_id: e.id, user_id: userId, variant_id: chosen.id }).onConflict((oc) => oc.doNothing()).returning('variant_id').executeTakeFirst();
        if (inserted) await this.analytics.track('experiment_exposure', { userId, properties: { experiment: e.key, variant: chosen.key } });
      }
      out[e.key] = { variant: chosen.key, config: chosen.config as Record<string, unknown> };
    }
    return out;
  }

  async upsert(adminId: string, input: ExperimentInput) {
    const total = input.variants.reduce((s, v) => s + v.allocation, 0);
    if (total !== 100) throw new AppError('VALIDATION_FAILED', 'Variant allocations must sum to 100');
    if (input.variants.filter((v) => v.isControl).length !== 1) throw new AppError('VALIDATION_FAILED', 'Exactly one control variant is required');
    if (new Set(input.variants.map((v) => v.key)).size !== input.variants.length) throw new AppError('VALIDATION_FAILED', 'Duplicate variant keys');
    if (input.surface === 'matching') {
      for (const v of input.variants) {
        const id = v.config.matching_config_version_id;
        if (typeof id !== 'string' || !(await this.db.selectFrom('matching_config_versions').select('id').where('id', '=', id).where('status', 'in', ['published', 'archived', 'draft']).executeTakeFirst())) {
          throw new AppError('VALIDATION_FAILED', `Variant ${v.key} needs a valid matching_config_version_id`);
        }
      }
    }
    const existing = await this.db.selectFrom('experiments').select(['id', 'status']).where('key', '=', input.key).executeTakeFirst();
    if (existing && existing.status !== 'draft') throw new AppError('VERSION_IMMUTABLE', 'Only draft experiments can be edited');
    const segmentId = input.segmentKey ? (await this.db.selectFrom('user_segments').select('id').where('key', '=', input.segmentKey).executeTakeFirst())?.id : null;
    if (input.segmentKey && !segmentId) throw new AppError('VALIDATION_FAILED', 'Unknown segment');
    return this.db.transaction().execute(async (trx) => {
      const v = { surface: input.surface, hypothesis: input.hypothesis ?? null, segment_id: segmentId ?? null, traffic_pct: input.trafficPct, primary_metric: input.primaryMetric, created_by: adminId };
      const e = await trx.insertInto('experiments').values({ key: input.key, ...v }).onConflict((oc) => oc.column('key').doUpdateSet(v)).returning('id').executeTakeFirstOrThrow();
      await trx.deleteFrom('experiment_variants').where('experiment_id', '=', e.id).execute();
      await trx.insertInto('experiment_variants').values(input.variants.map((x) => ({ experiment_id: e.id, key: x.key, allocation: x.allocation, is_control: x.isControl, config: JSON.stringify(x.config) }))).execute();
      await this.audit.record({ actorType: 'admin', actorId: adminId, action: 'experiments.upserted', targetType: 'experiment', targetId: input.key, after: input }, trx);
      return { id: e.id };
    });
  }

  async transition(adminId: string, key: string, to: 'running' | 'paused' | 'completed' | 'archived') {
    const e = await this.db.selectFrom('experiments').select(['id', 'status']).where('key', '=', key).executeTakeFirst();
    if (!e) throw new AppError('NOT_FOUND');
    const allowed: Record<string, string[]> = { draft: ['running', 'archived'], running: ['paused', 'completed'], paused: ['running', 'completed'], completed: ['archived'], archived: [] };
    if (!allowed[e.status]!.includes(to)) throw new AppError('CONFLICT', `Cannot move from ${e.status} to ${to}`);
    await this.db.updateTable('experiments').set({ status: to, ...(to === 'running' && e.status === 'draft' ? { started_at: new Date() } : {}), ...(to === 'completed' ? { ended_at: new Date() } : {}) }).where('id', '=', e.id).execute();
    await this.audit.record({ actorType: 'admin', actorId: adminId, action: `experiments.${to}`, targetType: 'experiment', targetId: key });
  }

  /** Conversion on the primary metric after assignment, per variant, vs control with significance. */
  async results(key: string) {
    const e = await this.db.selectFrom('experiments').selectAll().where('key', '=', key).executeTakeFirst();
    if (!e) throw new AppError('NOT_FOUND');
    const rows = await this.db.selectFrom('experiment_variants as v').leftJoin('experiment_assignments as a', 'a.variant_id', 'v.id')
      .select(['v.key', 'v.is_control', 'v.allocation',
        sql<number>`count(a.user_id)::int`.as('assigned'),
        sql<number>`count(a.user_id) FILTER (WHERE EXISTS (SELECT 1 FROM analytics_events ev WHERE ev.user_id = a.user_id AND ev.name = ${e.primary_metric} AND ev.occurred_at >= a.assigned_at))::int`.as('converted')])
      .where('v.experiment_id', '=', e.id).groupBy(['v.key', 'v.is_control', 'v.allocation']).orderBy('v.key').execute();
    const control = rows.find((r) => r.is_control);
    return {
      key: e.key, status: e.status, surface: e.surface, primaryMetric: e.primary_metric, startedAt: e.started_at, endedAt: e.ended_at,
      variants: rows.map((r) => ({
        key: r.key, isControl: r.is_control, allocation: r.allocation, assigned: r.assigned, converted: r.converted, rate: r.assigned ? r.converted / r.assigned : null,
        vsControl: !r.is_control && control ? twoProportionTest(control.converted, control.assigned, r.converted, r.assigned) : null,
      })),
    };
  }
}
