import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import type { preferencesUpdate } from '@amora/shared';
import { DATABASE, type Database } from '../../common/db/database';
import { AppError } from '../../common/errors/app-error';
import { OutboxService } from '../../common/outbox/outbox.service';

@Injectable()
export class PreferencesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
  ) {}

  async get(userId: string) {
    const p = await this.db.selectFrom('user_preferences').selectAll().where('user_id', '=', userId).executeTakeFirst();
    const terms = await this.db.selectFrom('user_preference_terms').select(['kind', 'term_id', 'is_dealbreaker']).where('user_id', '=', userId).execute();
    const grouped: Record<string, Array<{ termId: string; isDealbreaker: boolean }>> = {};
    for (const t of terms) (grouped[t.kind] ??= []).push({ termId: t.term_id, isDealbreaker: t.is_dealbreaker });
    return {
      ageMin: p?.age_min ?? 18,
      ageMax: p?.age_max ?? 99,
      maxDistanceKm: p?.max_distance_km ?? 50,
      distanceStrict: p?.distance_strict ?? false,
      ageStrict: p?.age_strict ?? true,
      heightMinCm: p?.height_min_cm ?? null,
      heightMaxCm: p?.height_max_cm ?? null,
      globalMode: p?.global_mode ?? false,
      verifiedOnly: p?.verified_only ?? false,
      terms: grouped,
    };
  }

  async update(userId: string, input: z.infer<typeof preferencesUpdate>, opts: { advancedFilters: boolean }) {
    const current = await this.get(userId);
    const ageMin = input.ageMin ?? current.ageMin;
    const ageMax = input.ageMax ?? current.ageMax;
    if (ageMin > ageMax) throw new AppError('VALIDATION_FAILED', 'ageMin must be <= ageMax', [{ path: 'ageMin', message: 'range' }]);

    // Gender, intent and goal preferences are basic; other attribute filters and deal-breakers are premium (BRD appx).
    const BASIC = new Set(['gender', 'dating_intent', 'relationship_goal']);
    const advancedUsed =
      input.verifiedOnly === true ||
      input.heightMinCm != null ||
      input.heightMaxCm != null ||
      Object.entries(input.terms ?? {}).some(([kind, items]) => (items?.length ?? 0) > 0 && (!BASIC.has(kind) || items!.some((i) => i.isDealbreaker && kind !== 'gender')));
    if (advancedUsed && !opts.advancedFilters) throw new AppError('ENTITLEMENT_REQUIRED', undefined, { entitlement: 'advanced_filters' });

    const values: Record<string, unknown> = { age_min: ageMin, age_max: ageMax };
    const map: Record<string, string> = { maxDistanceKm: 'max_distance_km', distanceStrict: 'distance_strict', ageStrict: 'age_strict', heightMinCm: 'height_min_cm', heightMaxCm: 'height_max_cm', globalMode: 'global_mode', verifiedOnly: 'verified_only' };
    for (const [k, col] of Object.entries(map)) if ((input as Record<string, unknown>)[k] !== undefined) values[col] = (input as Record<string, unknown>)[k];

    await this.db.transaction().execute(async (trx) => {
      await trx.insertInto('user_preferences').values({ user_id: userId, ...values }).onConflict((oc) => oc.column('user_id').doUpdateSet(values)).execute();
      for (const [kind, items] of Object.entries(input.terms ?? {})) {
        const list = items ?? [];
        const ids = [...new Set(list.map((i) => i.termId))];
        if (ids.length) {
          const found = await trx.selectFrom('taxonomy_terms').select('id').where('id', 'in', ids).where('kind', '=', kind).where('is_active', '=', true).execute();
          if (found.length !== ids.length) throw new AppError('VALIDATION_FAILED', `Invalid ${kind} preference`, [{ path: `terms.${kind}`, message: 'unknown' }]);
        }
        await trx.deleteFrom('user_preference_terms').where('user_id', '=', userId).where('kind', '=', kind).execute();
        if (ids.length) {
          await trx
            .insertInto('user_preference_terms')
            .values(ids.map((term_id) => ({ user_id: userId, term_id, kind, is_dealbreaker: list.find((i) => i.termId === term_id)!.isDealbreaker })))
            .execute();
        }
      }
    });
    await this.outbox.enqueue(this.db, 'preferences.changed', { userId }, { aggregateId: userId });
    return this.get(userId);
  }
}
