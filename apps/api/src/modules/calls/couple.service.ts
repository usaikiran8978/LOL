import { Inject, Injectable } from '@nestjs/common';
import { AnalyticsService } from '../../common/analytics/analytics.service';
import { DATABASE, type Database } from '../../common/db/database';
import { AppError } from '../../common/errors/app-error';
import { FlagsService } from '../platform/flags.service';
import { UserFactsService } from '../platform/user-facts.service';
import { ProfileStateService } from '../profiles/profile-state.service';

/**
 * Optional couple space for established couples (BRD §16). Both people must opt in. While active, each can choose to
 * step back from discovery; the shared space surfaces their journey milestones and completed dates.
 */
@Injectable()
export class CoupleService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly flags: FlagsService,
    private readonly facts: UserFactsService,
    private readonly profileState: ProfileStateService,
    private readonly analytics: AnalyticsService,
  ) {}

  private async match(userId: string, matchId: string) {
    await this.flags.assertEnabled('couple_space', await this.facts.load(userId));
    const m = await this.db.selectFrom('matches').select(['id', 'user_low_id', 'user_high_id', 'status']).where('id', '=', matchId).executeTakeFirst();
    if (!m || ![m.user_low_id, m.user_high_id].includes(userId)) throw new AppError('NOT_FOUND');
    if (m.status !== 'active') throw new AppError('CONVERSATION_CLOSED');
    return m;
  }

  async consent(userId: string, matchId: string, pauseDiscovery: boolean) {
    const m = await this.match(userId, matchId);
    const j = await this.db.selectFrom('relationship_journeys').select('first_date_at').where('match_id', '=', matchId).executeTakeFirst();
    if (!j?.first_date_at) throw new AppError('CONFLICT', 'Couple space opens after your first date');
    const col = m.user_low_id === userId ? 'low_consented_at' : 'high_consented_at';
    const space = await this.db.insertInto('couple_spaces').values({ match_id: matchId, [col]: new Date() })
      .onConflict((oc) => oc.column('match_id').doUpdateSet({ [col]: new Date(), status: 'pending', closed_at: null })).returningAll().executeTakeFirstOrThrow();
    if (space.low_consented_at && space.high_consented_at) {
      await this.db.updateTable('couple_spaces').set({ status: 'active' }).where('id', '=', space.id).execute();
      await this.db.updateTable('relationship_journeys').set({ stage: 'relationship', relationship_at: new Date() }).where('match_id', '=', matchId).execute();
    }
    if (pauseDiscovery) {
      await this.db.insertInto('user_privacy_settings').values({ user_id: userId, discoverable_by: 'nobody' }).onConflict((oc) => oc.column('user_id').doUpdateSet({ discoverable_by: 'nobody' })).execute();
      await this.profileState.recompute(userId);
    }
    await this.analytics.track('profile_updated', { userId, properties: { coupleSpace: true } });
    return this.get(userId, matchId);
  }

  async get(userId: string, matchId: string) {
    const m = await this.match(userId, matchId);
    const s = await this.db.selectFrom('couple_spaces').selectAll().where('match_id', '=', matchId).executeTakeFirst();
    if (!s) return { status: 'none' as const };
    const youConsented = !!(m.user_low_id === userId ? s.low_consented_at : s.high_consented_at);
    const [j, dates] = await Promise.all([
      this.db.selectFrom('relationship_journeys').selectAll().where('match_id', '=', matchId).executeTakeFirstOrThrow(),
      s.status === 'active' ? this.db.selectFrom('date_plans').select(['id', 'title', 'starts_at', 'venue_name']).where('match_id', '=', matchId).where('status', '=', 'completed').orderBy('starts_at', 'desc').execute() : Promise.resolve([]),
    ]);
    const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);
    return {
      status: s.status, youConsented,
      timeline: s.status === 'active' ? { matchedAt: null, conversationAt: iso(j.conversation_at), firstDateAt: iso(j.first_date_at), secondDateAt: iso(j.second_date_at), relationshipAt: iso(j.relationship_at) } : null,
      dates: dates.map((d) => ({ id: d.id, title: d.title, at: new Date(d.starts_at).toISOString(), venue: d.venue_name })),
    };
  }

  async close(userId: string, matchId: string) {
    await this.match(userId, matchId);
    await this.db.updateTable('couple_spaces').set({ status: 'closed', closed_at: new Date() }).where('match_id', '=', matchId).execute();
  }
}
