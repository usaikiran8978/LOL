import { Inject, Injectable } from '@nestjs/common';
import type { Facts } from '@amora/shared';
import { DATABASE, type Database } from '../../common/db/database';
import { ageOn } from '../auth/age';

export interface UserFacts extends Facts {
  userId: string;
  countryCode: string | null;
  locale: string;
  age: number | null;
  gender: string | null;
  orientation: string | null;
  datingIntent: string | null;
  relationshipGoal: string | null;
  verificationLevel: string;
  isVerified: boolean;
  accountAgeDays: number;
  entitlements: string[];
  religionFieldEnabled: boolean;
  platform?: string;
  appVersion?: string;
}

/**
 * Flat, non-sensitive facts about a user used for targeting (flags, segments, question targeting, onboarding
 * conditions). Orientation/religion are only used for applicability rules, never logged (DEC-007).
 */
@Injectable()
export class UserFactsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async load(userId: string, client: { platform?: string; appVersion?: string } = {}): Promise<UserFacts> {
    const row = await this.db
      .selectFrom('users as u')
      .leftJoin('user_profiles as p', 'p.user_id', 'u.id')
      .leftJoin('taxonomy_terms as g', 'g.id', 'p.gender_id')
      .leftJoin('taxonomy_terms as o', 'o.id', 'p.orientation_id')
      .leftJoin('taxonomy_terms as i', 'i.id', 'p.dating_intent_id')
      .leftJoin('taxonomy_terms as r', 'r.id', 'p.relationship_goal_id')
      .leftJoin('country_configs as cc', 'cc.country_code', 'u.country_code')
      .select([
        'u.id', 'u.country_code', 'u.locale', 'u.date_of_birth', 'u.created_at', 'p.verification_level',
        'g.key as gender', 'o.key as orientation', 'i.key as intent', 'r.key as goal', 'cc.religion_field_enabled',
      ])
      .where('u.id', '=', userId)
      .executeTakeFirstOrThrow();
    const ents = await this.db
      .selectFrom('entitlements')
      .select('entitlement_key')
      .distinct()
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null)
      .where('starts_at', '<=', new Date())
      .where((eb) => eb.or([eb('ends_at', 'is', null), eb('ends_at', '>', new Date())]))
      .execute();
    const level = row.verification_level ?? 'none';
    return {
      userId,
      countryCode: row.country_code,
      locale: row.locale,
      age: row.date_of_birth ? ageOn(String(row.date_of_birth)) : null,
      gender: row.gender,
      orientation: row.orientation,
      datingIntent: row.intent,
      relationshipGoal: row.goal,
      verificationLevel: level,
      isVerified: level === 'selfie' || level === 'identity',
      accountAgeDays: Math.floor((Date.now() - new Date(row.created_at).getTime()) / 86_400_000),
      entitlements: ents.map((e) => e.entitlement_key),
      religionFieldEnabled: row.religion_field_enabled ?? true,
      ...client,
    };
  }
}
