import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { sql } from 'kysely';
import { DATABASE, type Database } from '../../common/db/database';
import { JobScheduler } from '../../common/jobs/scheduler';
import { learnAffinities, type OutcomeSample } from './adaptive';

/** Nightly job that learns user_preference_signals from outcomes (likes/passes and post-date feedback). */
@Injectable()
export class AdaptiveService implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly jobs: JobScheduler,
  ) {}

  onModuleInit(): void {
    this.jobs.register('matching.learn_affinities', 24 * 3600, async () => {
      await this.learnAll();
    });
  }

  async learnAll(): Promise<number> {
    const users = await this.db.selectFrom('swipe_actions').select('actor_id').distinct().where('created_at', '>', new Date(Date.now() - 90 * 86_400_000)).execute();
    let n = 0;
    for (const u of users) if (await this.learn(u.actor_id)) n++;
    return n;
  }

  async learn(userId: string): Promise<boolean> {
    const since = new Date(Date.now() - 90 * 86_400_000);
    const rows = await this.db.selectFrom('swipe_actions as s').innerJoin('match_candidates as mc', 'mc.id', 's.candidate_id')
      .select(['s.action', 's.target_id', 'mc.factor_scores']).where('s.actor_id', '=', userId).where('s.created_at', '>', since).where('s.rewound_at', 'is', null).execute();
    const goodDates = new Set((await this.db.selectFrom('date_feedback').select('about_user_id').where('author_id', '=', userId)
      .where((eb) => eb.or([eb('want_second_date', '=', 'yes'), eb('overall', '>=', 4)])).execute()).map((r) => r.about_user_id));
    const samples: OutcomeSample[] = rows.map((r) => ({
      positive: r.action !== 'pass',
      // Real-world outcomes outweigh swipes (optimise for meaningful connections, not likes — MP §7).
      weight: goodDates.has(r.target_id) ? 3 : r.action === 'super_like' ? 1.5 : 1,
      categoryScores: r.factor_scores as Record<string, number>,
    }));
    const learned = learnAffinities(samples);
    if (!Object.keys(learned).length) return false;
    const cats = await this.db.selectFrom('compatibility_categories').select(['id', 'key']).execute();
    await this.db.transaction().execute(async (trx) => {
      await trx.deleteFrom('user_preference_signals').where('user_id', '=', userId).execute();
      const values = Object.entries(learned).flatMap(([k, v]) => {
        const c = cats.find((x) => x.key === k);
        return c ? [{ user_id: userId, compatibility_category_id: c.id, affinity: v.affinity, sample_size: v.n }] : [];
      });
      if (values.length) await trx.insertInto('user_preference_signals').values(values).execute();
    });
    return true;
  }

  async affinities(userId: string): Promise<Record<string, number>> {
    const rows = await this.db.selectFrom('user_preference_signals as s').innerJoin('compatibility_categories as c', 'c.id', 's.compatibility_category_id')
      .select(['c.key', sql<string>`s.affinity`.as('affinity')]).where('s.user_id', '=', userId).execute();
    return Object.fromEntries(rows.map((r) => [r.key, Number(r.affinity)]));
  }
}
