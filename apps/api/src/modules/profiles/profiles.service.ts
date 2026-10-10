import { Inject, Injectable } from '@nestjs/common';
import { MULTI_ATTRIBUTE_KINDS, type DistanceBucket, type ProfileUpdate } from '@amora/shared';
import type { z } from 'zod';
import type { privacyUpdate } from '@amora/shared';
import { AnalyticsService } from '../../common/analytics/analytics.service';
import { DATABASE, type Database, type Tx } from '../../common/db/database';
import { activeMatch, blockedEitherWay } from '../../common/db/relations';
import { AppError } from '../../common/errors/app-error';
import { distanceBucket, haversineKm } from '../../common/geo/geo';
import { OutboxService } from '../../common/outbox/outbox.service';
import { ageOn } from '../auth/age';
import { CatalogService } from '../catalog/catalog.service';
import { MediaService } from './media.service';
import { ProfileStateService } from './profile-state.service';

const TERM_FIELDS: Array<[keyof ProfileUpdate, string, string]> = [
  ['genderId', 'gender_id', 'gender'],
  ['orientationId', 'orientation_id', 'orientation'],
  ['datingIntentId', 'dating_intent_id', 'dating_intent'],
  ['relationshipGoalId', 'relationship_goal_id', 'relationship_goal'],
  ['relationshipStatusId', 'relationship_status_id', 'relationship_status'],
  ['educationLevelId', 'education_level_id', 'education_level'],
];

@Injectable()
export class ProfilesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly media: MediaService,
    private readonly state: ProfileStateService,
    private readonly catalog: CatalogService,
    private readonly outbox: OutboxService,
    private readonly analytics: AnalyticsService,
  ) {}

  // ------------------------------------------------------------------ own profile

  async getOwn(userId: string, locale: string) {
    const p = await this.db.selectFrom('user_profiles').selectAll().where('user_id', '=', userId).executeTakeFirst();
    const [attributes, interests, languages, prompts, privacy, media, user] = await Promise.all([
      this.db.selectFrom('user_profile_attributes').select(['kind', 'term_id']).where('user_id', '=', userId).execute(),
      this.db.selectFrom('user_interests').select('interest_id').where('user_id', '=', userId).orderBy('position').execute(),
      this.db.selectFrom('user_languages').select(['language_code', 'proficiency']).where('user_id', '=', userId).execute(),
      this.db.selectFrom('profile_prompts').select(['id', 'prompt_id', 'answer', 'position', 'moderation_status']).where('user_id', '=', userId).orderBy('position').execute(),
      this.privacy(userId),
      this.media.list(userId),
      this.db.selectFrom('users').select(['date_of_birth']).where('id', '=', userId).executeTakeFirstOrThrow(),
    ]);
    const city = p?.city_id ? await this.db.selectFrom('cities').select(['id', 'name', 'country_code', 'admin_region']).where('id', '=', p.city_id).executeTakeFirst() : undefined;
    const termIds = [...attributes.map((a) => a.term_id), ...TERM_FIELDS.map(([, col]) => (p as Record<string, unknown> | undefined)?.[col] as string | null).filter((x): x is string => !!x)];
    const terms = await this.labelTerms(termIds, locale);
    return {
      exists: !!p,
      displayName: p?.display_name ?? null,
      bio: p?.bio ?? null,
      age: user.date_of_birth ? ageOn(String(user.date_of_birth)) : null,
      gender: terms.get(p?.gender_id ?? '') ?? null,
      orientation: terms.get(p?.orientation_id ?? '') ?? null,
      datingIntent: terms.get(p?.dating_intent_id ?? '') ?? null,
      relationshipGoal: terms.get(p?.relationship_goal_id ?? '') ?? null,
      relationshipStatus: terms.get(p?.relationship_status_id ?? '') ?? null,
      educationLevel: terms.get(p?.education_level_id ?? '') ?? null,
      profession: p?.profession ?? null,
      employer: p?.employer ?? null,
      school: p?.school ?? null,
      heightCm: p?.height_cm ?? null,
      cityId: p?.city_id ?? null,
      city: city ? { id: city.id, name: city.name, countryCode: city.country_code, region: city.admin_region } : null,
      homeCountryCode: p?.home_country_code ?? null,
      attributes: groupBy(attributes.map((a) => ({ kind: a.kind, term: terms.get(a.term_id)! })), (a) => a.kind, (a) => a.term),
      interestIds: interests.map((i) => i.interest_id),
      languages: languages.map((l) => ({ code: l.language_code, proficiency: l.proficiency })),
      prompts: prompts.map((pr) => ({ id: pr.id, promptId: pr.prompt_id, answer: pr.answer, moderationStatus: pr.moderation_status })),
      media,
      privacy,
      verificationLevel: p?.verification_level ?? 'none',
      completeness: p?.completeness_score ?? 0,
      discoverable: p?.is_discoverable ?? false,
      moderationStatus: p?.moderation_status ?? 'pending',
    };
  }

  async update(userId: string, input: ProfileUpdate, locale: string) {
    const existing = await this.db.selectFrom('user_profiles').select(['user_id', 'bio', 'display_name']).where('user_id', '=', userId).executeTakeFirst();
    if (!existing && !input.displayName) throw new AppError('VALIDATION_FAILED', 'displayName is required to create a profile', [{ path: 'displayName', message: 'required' }]);

    const values: Record<string, unknown> = {};
    for (const [field, column, kind] of TERM_FIELDS) {
      const id = input[field] as string | null | undefined;
      if (id === undefined) continue;
      if (id !== null) await this.assertTerms([id], kind);
      values[column] = id;
    }
    if (input.cityId !== undefined) {
      if (input.cityId !== null && !(await this.db.selectFrom('cities').select('id').where('id', '=', input.cityId).where('is_active', '=', true).executeTakeFirst())) {
        throw new AppError('VALIDATION_FAILED', 'Unknown city', [{ path: 'cityId', message: 'unknown' }]);
      }
      values.city_id = input.cityId;
      if (input.cityId) {
        // Without GPS the coarse location is the city's cell.
        const city = await this.db.selectFrom('cities').select('geohash5').where('id', '=', input.cityId).executeTakeFirstOrThrow();
        const hasGps = await this.db.selectFrom('user_locations').select('user_id').where('user_id', '=', userId).where('source', 'in', ['gps', 'network']).executeTakeFirst();
        if (!hasGps) values.geohash5 = city.geohash5;
      }
    }
    const simple: Array<[keyof ProfileUpdate, string]> = [['displayName', 'display_name'], ['bio', 'bio'], ['profession', 'profession'], ['employer', 'employer'], ['school', 'school'], ['heightCm', 'height_cm'], ['homeCountryCode', 'home_country_code']];
    for (const [field, column] of simple) if (input[field] !== undefined) values[column] = input[field] === '' ? null : input[field];

    await this.db.transaction().execute(async (trx) => {
      if (existing) {
        if (Object.keys(values).length) await trx.updateTable('user_profiles').set(values).where('user_id', '=', userId).execute();
      } else {
        await trx.insertInto('user_profiles').values({ user_id: userId, display_name: input.displayName!, ...values }).execute();
        await trx.insertInto('user_privacy_settings').values({ user_id: userId }).onConflict((oc) => oc.column('user_id').doNothing()).execute();
        await trx.insertInto('user_preferences').values({ user_id: userId }).onConflict((oc) => oc.column('user_id').doNothing()).execute();
      }
      // Free text goes through moderation (P7 consumer); keep the event even before the consumer exists.
      const textChanged = (values.bio !== undefined && values.bio !== existing?.bio) || (values.display_name !== undefined && values.display_name !== existing?.display_name);
      if (textChanged) await this.outbox.enqueue(trx, 'profile.text_changed', { userId, fields: ['bio', 'display_name'].filter((f) => values[f] !== undefined) }, { aggregateId: userId });
    });
    await this.state.recompute(userId);
    await this.analytics.track('profile_updated', { userId, properties: { fields: Object.keys(values).length } });
    return this.getOwn(userId, locale);
  }

  async setAttributes(userId: string, attributes: Partial<Record<string, string[]>>, locale: string) {
    await this.requireProfile(userId);
    await this.db.transaction().execute(async (trx) => {
      for (const [kind, ids] of Object.entries(attributes)) {
        const unique = [...new Set(ids ?? [])];
        if (unique.length > 1 && !MULTI_ATTRIBUTE_KINDS.includes(kind)) throw new AppError('VALIDATION_FAILED', `${kind} accepts a single value`, [{ path: `attributes.${kind}`, message: 'single' }]);
        if (unique.length) await this.assertTerms(unique, kind, trx);
        await trx.deleteFrom('user_profile_attributes').where('user_id', '=', userId).where('kind', '=', kind).execute();
        if (unique.length) await trx.insertInto('user_profile_attributes').values(unique.map((term_id) => ({ user_id: userId, term_id, kind }))).execute();
      }
    });
    await this.state.recompute(userId);
    return this.getOwn(userId, locale);
  }

  async setInterests(userId: string, interestIds: string[], locale: string) {
    await this.requireProfile(userId);
    const unique = [...new Set(interestIds)];
    if (unique.length) {
      const found = await this.db.selectFrom('interests').select('id').where('id', 'in', unique).where('is_active', '=', true).execute();
      if (found.length !== unique.length) throw new AppError('VALIDATION_FAILED', 'Unknown interest', [{ path: 'interestIds', message: 'unknown' }]);
    }
    await this.db.transaction().execute(async (trx) => {
      await trx.deleteFrom('user_interests').where('user_id', '=', userId).execute();
      if (unique.length) await trx.insertInto('user_interests').values(unique.map((interest_id, position) => ({ user_id: userId, interest_id, position }))).execute();
    });
    await this.state.recompute(userId);
    return this.getOwn(userId, locale);
  }

  async setLanguages(userId: string, languages: Array<{ code: string; proficiency: string }>, locale: string) {
    await this.requireProfile(userId);
    const codes = [...new Set(languages.map((l) => l.code))];
    if (codes.length) {
      const found = await this.db.selectFrom('languages').select('code').where('code', 'in', codes).execute();
      if (found.length !== codes.length) throw new AppError('VALIDATION_FAILED', 'Unknown language', [{ path: 'languages', message: 'unknown' }]);
    }
    await this.db.transaction().execute(async (trx) => {
      await trx.deleteFrom('user_languages').where('user_id', '=', userId).execute();
      const rows = codes.map((code) => ({ user_id: userId, language_code: code, proficiency: languages.find((l) => l.code === code)!.proficiency }));
      if (rows.length) await trx.insertInto('user_languages').values(rows).execute();
    });
    await this.state.recompute(userId);
    return this.getOwn(userId, locale);
  }

  async setPrompts(userId: string, prompts: Array<{ promptId: string; answer: string }>, locale: string) {
    await this.requireProfile(userId);
    const ids = prompts.map((p) => p.promptId);
    if (new Set(ids).size !== ids.length) throw new AppError('VALIDATION_FAILED', 'Duplicate prompt');
    if (ids.length) {
      const found = await this.db.selectFrom('prompt_catalog').select('id').where('id', 'in', ids).where('is_active', '=', true).execute();
      if (found.length !== ids.length) throw new AppError('VALIDATION_FAILED', 'Unknown prompt', [{ path: 'prompts', message: 'unknown' }]);
    }
    await this.db.transaction().execute(async (trx) => {
      const before = await trx.selectFrom('profile_prompts').select(['prompt_id', 'answer', 'moderation_status']).where('user_id', '=', userId).execute();
      await trx.deleteFrom('profile_prompts').where('user_id', '=', userId).execute();
      if (prompts.length) {
        await trx
          .insertInto('profile_prompts')
          .values(
            prompts.map((p, position) => {
              const prev = before.find((b) => b.prompt_id === p.promptId && b.answer === p.answer);
              // Unchanged answers keep their moderation decision; edited ones are re-reviewed.
              return { user_id: userId, prompt_id: p.promptId, answer: p.answer, position, moderation_status: prev?.moderation_status ?? 'pending' };
            }),
          )
          .execute();
        if (prompts.some((p) => !before.find((b) => b.prompt_id === p.promptId && b.answer === p.answer))) {
          await this.outbox.enqueue(trx, 'profile.text_changed', { userId, fields: ['prompts'] }, { aggregateId: userId });
        }
      }
    });
    await this.state.recompute(userId);
    return this.getOwn(userId, locale);
  }

  async privacy(userId: string) {
    const ps = await this.db.selectFrom('user_privacy_settings').selectAll().where('user_id', '=', userId).executeTakeFirst();
    const p = await this.db.selectFrom('user_profiles').select(['incognito', 'snoozed_until']).where('user_id', '=', userId).executeTakeFirst();
    return {
      showAge: ps?.show_age ?? true,
      showDistance: ps?.show_distance ?? true,
      showCity: ps?.show_city ?? true,
      showOnlineStatus: ps?.show_online_status ?? true,
      showReadReceipts: ps?.show_read_receipts ?? true,
      showOrientation: ps?.show_orientation ?? false,
      showReligion: ps?.show_religion ?? true,
      showVerification: ps?.show_verification ?? true,
      allowAiProfileAnalysis: ps?.allow_ai_profile_analysis ?? false,
      allowAiMessageAnalysis: ps?.allow_ai_message_analysis ?? false,
      allowTranslation: ps?.allow_translation ?? true,
      discoverableBy: ps?.discoverable_by ?? 'everyone',
      incognito: p?.incognito ?? false,
      snoozedUntil: p?.snoozed_until ? new Date(p.snoozed_until).toISOString() : null,
    };
  }

  async updatePrivacy(userId: string, input: z.infer<typeof privacyUpdate>, hasIncognitoEntitlement: boolean) {
    await this.requireProfile(userId);
    if (input.incognito && !hasIncognitoEntitlement) throw new AppError('ENTITLEMENT_REQUIRED', undefined, { entitlement: 'incognito' });
    const map: Record<string, string> = {
      showAge: 'show_age', showDistance: 'show_distance', showCity: 'show_city', showOnlineStatus: 'show_online_status', showReadReceipts: 'show_read_receipts',
      showOrientation: 'show_orientation', showReligion: 'show_religion', showVerification: 'show_verification', allowAiProfileAnalysis: 'allow_ai_profile_analysis',
      allowAiMessageAnalysis: 'allow_ai_message_analysis', allowTranslation: 'allow_translation', discoverableBy: 'discoverable_by',
    };
    const values: Record<string, unknown> = {};
    for (const [k, col] of Object.entries(map)) if ((input as Record<string, unknown>)[k] !== undefined) values[col] = (input as Record<string, unknown>)[k];
    await this.db.transaction().execute(async (trx) => {
      await trx
        .insertInto('user_privacy_settings')
        .values({ user_id: userId, ...values })
        .onConflict((oc) => (Object.keys(values).length ? oc.column('user_id').doUpdateSet(values) : oc.column('user_id').doNothing()))
        .execute();
      const profileValues: Record<string, unknown> = {};
      if (input.incognito !== undefined) profileValues.incognito = input.incognito;
      if (input.snoozedUntil !== undefined) profileValues.snoozed_until = input.snoozedUntil ? new Date(input.snoozedUntil) : null;
      if (Object.keys(profileValues).length) await trx.updateTable('user_profiles').set(profileValues).where('user_id', '=', userId).execute();
    });
    await this.state.recompute(userId);
    return this.privacy(userId);
  }

  // ------------------------------------------------------------------ viewing other users

  /**
   * Another user's profile, filtered by the subject's privacy settings. Never includes exact location, internal
   * scores, contact details or moderation data. Blocked pairs get NOT_FOUND (indistinguishable from non-existence).
   */
  async view(viewerId: string, subjectId: string, surface: string, locale: string) {
    if (viewerId === subjectId) throw new AppError('VALIDATION_FAILED', 'Use /profiles/me for your own profile');
    const subject = await this.db
      .selectFrom('user_profiles as p')
      .innerJoin('users as u', 'u.id', 'p.user_id')
      .leftJoin('user_privacy_settings as ps', 'ps.user_id', 'p.user_id')
      .leftJoin('cities as c', 'c.id', 'p.city_id')
      .select([
        'p.user_id', 'p.display_name', 'p.bio', 'p.gender_id', 'p.orientation_id', 'p.dating_intent_id', 'p.relationship_goal_id', 'p.relationship_status_id',
        'p.education_level_id', 'p.profession', 'p.employer', 'p.school', 'p.height_cm', 'p.verification_level', 'p.is_discoverable', 'p.incognito', 'p.moderation_status',
        'u.status', 'u.date_of_birth', 'u.last_active_at', 'c.name as city_name', 'ps.show_age', 'ps.show_distance', 'ps.show_city', 'ps.show_orientation',
        'ps.show_religion', 'ps.show_verification', 'ps.show_online_status', 'ps.discoverable_by',
      ])
      .where('p.user_id', '=', subjectId)
      .executeTakeFirst();
    if (!subject || !['active', 'restricted'].includes(subject.status) || subject.moderation_status === 'rejected') throw new AppError('NOT_FOUND');
    if (await blockedEitherWay(this.db, viewerId, subjectId)) throw new AppError('NOT_FOUND');

    const matched = !!(await activeMatch(this.db, viewerId, subjectId));
    if (!matched) {
      const likedViewer = await this.db.selectFrom('swipe_actions').select('id').where('actor_id', '=', subjectId).where('target_id', '=', viewerId).where('action', 'in', ['like', 'super_like']).where('rewound_at', 'is', null).executeTakeFirst();
      const restrictedVisibility = subject.discoverable_by === 'nobody' || ((subject.discoverable_by === 'liked_only' || subject.incognito) && !likedViewer);
      if (restrictedVisibility || (!subject.is_discoverable && !likedViewer)) throw new AppError('NOT_FOUND');
    }

    const [attributes, interests, prompts, media, distance, favorite] = await Promise.all([
      this.db.selectFrom('user_profile_attributes as a').innerJoin('taxonomy_terms as t', 't.id', 'a.term_id').select(['a.kind', 'a.term_id', 't.is_sensitive']).where('a.user_id', '=', subjectId).execute(),
      this.db.selectFrom('user_interests').select('interest_id').where('user_id', '=', subjectId).orderBy('position').execute(),
      this.db.selectFrom('profile_prompts as pp').select(['pp.prompt_id', 'pp.answer']).where('pp.user_id', '=', subjectId).where('pp.moderation_status', '=', 'approved').orderBy('pp.position').execute(),
      this.media.publicMedia(subjectId),
      subject.show_distance === false ? Promise.resolve(null) : this.distanceBetween(viewerId, subjectId),
      this.db.selectFrom('user_favorites').select('target_id').where('user_id', '=', viewerId).where('target_id', '=', subjectId).executeTakeFirst(),
    ]);

    const hideReligion = subject.show_religion === false;
    const visibleAttributes = attributes.filter((a) => !(hideReligion && a.kind.startsWith('religion')));
    const termIds = [
      ...visibleAttributes.map((a) => a.term_id),
      ...[subject.gender_id, subject.dating_intent_id, subject.relationship_goal_id, subject.relationship_status_id, subject.education_level_id].filter((x): x is string => !!x),
      ...(subject.show_orientation && subject.orientation_id ? [subject.orientation_id] : []),
    ];
    const terms = await this.labelTerms(termIds, locale);
    const interestLabels = await this.catalog.interests(locale).then((cats) => new Map(cats.flatMap((c) => c.interests).map((i) => [i.id, i.label])));
    const promptText = await this.catalog.prompts(locale).then((ps) => new Map(ps.map((p) => [p.id, p.text])));

    await this.db
      .insertInto('profile_views')
      .values({ viewer_id: viewerId, viewed_id: subjectId, surface })
      .onConflict((oc) => oc.columns(['viewer_id', 'viewed_id', 'viewed_on']).doUpdateSet((eb) => ({ view_count: eb('profile_views.view_count', '+', 1), last_viewed_at: new Date() })))
      .execute();
    await this.analytics.track('profile_viewed', { userId: viewerId, properties: { surface } });

    return {
      id: subject.user_id,
      displayName: subject.display_name,
      age: subject.show_age === false || !subject.date_of_birth ? null : ageOn(String(subject.date_of_birth)),
      bio: subject.bio,
      city: subject.show_city === false ? null : subject.city_name,
      distance: distance as DistanceBucket | null,
      gender: terms.get(subject.gender_id ?? '') ?? null,
      orientation: subject.show_orientation ? (terms.get(subject.orientation_id ?? '') ?? null) : null,
      datingIntent: terms.get(subject.dating_intent_id ?? '') ?? null,
      relationshipGoal: terms.get(subject.relationship_goal_id ?? '') ?? null,
      relationshipStatus: terms.get(subject.relationship_status_id ?? '') ?? null,
      educationLevel: terms.get(subject.education_level_id ?? '') ?? null,
      profession: subject.profession,
      employer: subject.employer,
      school: subject.school,
      heightCm: subject.height_cm,
      verified: subject.show_verification === false ? null : ['selfie', 'identity'].includes(subject.verification_level),
      recentlyActive: subject.show_online_status === false || !subject.last_active_at ? null : Date.now() - new Date(subject.last_active_at).getTime() < 24 * 3_600_000,
      attributes: groupBy(visibleAttributes.map((a) => ({ kind: a.kind, term: terms.get(a.term_id) })).filter((a) => a.term), (a) => a.kind, (a) => a.term!),
      interests: interests.map((i) => ({ id: i.interest_id, label: interestLabels.get(i.interest_id) ?? null })),
      prompts: prompts.map((p) => ({ promptId: p.prompt_id, prompt: promptText.get(p.prompt_id) ?? null, answer: p.answer })),
      media: media.map(({ moderationStatus: _m, processingStatus: _p, ...m }) => m),
      matched,
      favorited: !!favorite,
    };
  }

  /** Bucketed distance from both users' private locations (or city cells). Never the raw value (DEC-008). */
  private async distanceBetween(a: string, b: string): Promise<DistanceBucket | null> {
    const rows = await this.db.selectFrom('user_locations').select(['user_id', 'latitude', 'longitude']).where('user_id', 'in', [a, b]).execute();
    const la = rows.find((r) => r.user_id === a);
    const lb = rows.find((r) => r.user_id === b);
    if (!la || !lb) return null;
    return distanceBucket(haversineKm(la.latitude, la.longitude, lb.latitude, lb.longitude));
  }

  // ------------------------------------------------------------------ helpers

  private async requireProfile(userId: string): Promise<void> {
    const p = await this.db.selectFrom('user_profiles').select('user_id').where('user_id', '=', userId).executeTakeFirst();
    if (!p) throw new AppError('PROFILE_INCOMPLETE', 'Create your profile first');
  }

  private async assertTerms(ids: string[], kind: string, trx: Tx | Database = this.db): Promise<void> {
    const found = await trx.selectFrom('taxonomy_terms').select('id').where('id', 'in', ids).where('kind', '=', kind).where('is_active', '=', true).execute();
    if (found.length !== new Set(ids).size) throw new AppError('VALIDATION_FAILED', `Invalid ${kind} value`, [{ path: kind, message: 'unknown' }]);
  }

  private async labelTerms(ids: string[], locale: string): Promise<Map<string, { id: string; key: string; label: string }>> {
    if (!ids.length) return new Map();
    const kinds = await this.db.selectFrom('taxonomy_terms').select('kind').distinct().where('id', 'in', ids).execute();
    const terms = await this.catalog.terms(kinds.map((k) => k.kind), locale);
    return new Map(terms.filter((t) => ids.includes(t.id)).map((t) => [t.id, { id: t.id, key: t.key, label: t.label }]));
  }
}

function groupBy<T, V>(items: T[], key: (t: T) => string, value: (t: T) => V): Record<string, V[]> {
  const out: Record<string, V[]> = {};
  for (const i of items) (out[key(i)] ??= []).push(value(i));
  return out;
}
