import { activeUser, adminSession, createTestApp, discoverableUser, grant, type TestApp } from './helpers';

// Each describe uses its own city so users from other suites/tests don't interfere.
const SYDNEY = { lat: -33.8688, lon: 151.2093 };
const MELBOURNE = { lat: -37.8136, lon: 144.9631 };
const TORONTO = { lat: 43.6532, lon: -79.3832 };
const DUBAI = { lat: 25.2048, lon: 55.2708 };

type Card = { userId: string; candidateRowId: string; compatibility: number; topFactors: Array<{ categoryKey: string; label: string; reasonKey: string }>; differences: unknown; breakdown: unknown; distance: string | null; photos: unknown[] };

describe('Matching & discovery (e2e)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  const feed = async (auth: Record<string, string>, surface = 'smart', extra = '') => (await t.http.get(`/v1/recommendations?surface=${surface}${extra}`).set(auth).expect(200)).body as { items: Card[]; limitReached: boolean };

  describe('recommendations', () => {
    it('recommends mutually compatible people with explainable scores, excluding preference mismatches and blocks', async () => {
      const seeker = await discoverableUser(t, { gender: 'woman', seeking: ['man'], ...SYDNEY });
      const good = await discoverableUser(t, { gender: 'man', seeking: ['woman'], ...SYDNEY, interestKeys: ['hiking', 'coffee', 'reading'] });
      const wrongGender = await discoverableUser(t, { gender: 'woman', seeking: ['woman'], ...SYDNEY });
      const notSeekingHer = await discoverableUser(t, { gender: 'man', seeking: ['man'], ...SYDNEY });
      const blocked = await discoverableUser(t, { gender: 'man', seeking: ['woman'], ...SYDNEY });
      await t.db.insertInto('blocks').values({ blocker_id: blocked.id, blocked_id: seeker.id }).execute();

      const res = await feed(seeker.auth);
      const ids = res.items.map((c) => c.userId);
      expect(ids).toContain(good.id);
      expect(ids).not.toEqual(expect.arrayContaining([wrongGender.id]));
      expect(ids).not.toContain(notSeekingHer.id);
      expect(ids).not.toContain(blocked.id);

      const card = res.items.find((c) => c.userId === good.id)!;
      expect(card.compatibility).toBeGreaterThan(50);
      expect(card.topFactors[0]).toMatchObject({ reasonKey: expect.stringMatching(/^match\.reason\./), label: expect.any(String) });
      expect(card.breakdown).toEqual(expect.any(Array));
      expect(card.distance).toBe('lt_2km');
      expect(JSON.stringify(card)).not.toMatch(/final_score|finalScore|risk|latitude/);

      const row = await t.db.selectFrom('match_candidates').select(['config_version_id', 'top_factors', 'served_at']).where('user_id', '=', seeker.id).where('candidate_id', '=', good.id).executeTakeFirstOrThrow();
      expect(row.served_at).not.toBeNull();
      expect(row.config_version_id).toEqual(expect.any(String));
    });

    it('enforces question deal-breakers from answers', async () => {
      const seeker = await discoverableUser(t, { gender: 'woman', seeking: ['man'], ...MELBOURNE, answers: { wants_children: { body: { value: { optionKey: 'want' }, isDealbreaker: true, importance: 3, acceptableOptionKeys: ['want', 'open'] } } } });
      const compatible = await discoverableUser(t, { gender: 'man', seeking: ['woman'], ...MELBOURNE, answers: { wants_children: { optionKey: 'open' } } });
      const conflicting = await discoverableUser(t, { gender: 'man', seeking: ['woman'], ...MELBOURNE, answers: { wants_children: { optionKey: 'dont_want' } } });
      const ids = (await feed(seeker.auth)).items.map((c) => c.userId);
      expect(ids).toContain(compatible.id);
      expect(ids).not.toContain(conflicting.id);
    });

    it('requires completed onboarding and meters smart matches on the free tier', async () => {
      const fresh = await activeUser(t);
      await t.http.put('/v1/profiles/me').set(fresh.auth).send({ displayName: 'New' }).expect(200);
      expect((await t.http.get('/v1/recommendations?surface=smart').set(fresh.auth).expect(409)).body.error.code).toBe('PROFILE_INCOMPLETE');

      const seeker = await discoverableUser(t, { gender: 'man', seeking: ['woman'], ...TORONTO });
      for (let i = 0; i < 3; i++) await discoverableUser(t, { gender: 'woman', seeking: ['man'], ...TORONTO });
      await t.db.updateTable('free_tier_limits').set({ limit_value: 2 }).where('entitlement_key', '=', 'smart_matches').execute();
      try {
        expect((await feed(seeker.auth, 'smart', '&limit=5')).items).toHaveLength(2);
        const next = await feed(seeker.auth, 'smart');
        expect(next).toMatchObject({ items: [], limitReached: true });
        expect((await feed(seeker.auth, 'swipe')).items.length).toBeGreaterThan(0); // swipe deck isn't metered
      } finally {
        await t.db.updateTable('free_tier_limits').set({ limit_value: 5 }).where('entitlement_key', '=', 'smart_matches').execute();
      }
    });

    it('gates travel mode behind the flag and the entitlement', async () => {
      const u = await discoverableUser(t, { gender: 'man', seeking: ['woman'], ...DUBAI });
      const city = await t.db.selectFrom('cities').select('id').where('name', '=', 'Paris').executeTakeFirstOrThrow();
      const start = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
      const end = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
      expect((await t.http.post('/v1/travel-plans').set(u.auth).send({ cityId: city.id, startsOn: start, endsOn: end }).expect(402)).body.error.details.entitlement).toBe('travel_mode');
      await grant(t, u.id, 'travel_mode');
      await t.http.post('/v1/travel-plans').set(u.auth).send({ cityId: city.id, startsOn: start, endsOn: end }).expect(201);
      const local = await discoverableUser(t, { gender: 'woman', seeking: ['man'], lat: 48.8566, lon: 2.3522 });
      expect((await feed(u.auth, 'travel')).items.map((c) => c.userId)).toContain(local.id);
    });
  });

  describe('likes, matches, rewind', () => {
    it('creates a match and conversation on a mutual like', async () => {
      const a = await discoverableUser(t, { gender: 'woman', seeking: ['man'], lat: 51.5072, lon: -0.1276 });
      const b = await discoverableUser(t, { gender: 'man', seeking: ['woman'], lat: 51.5072, lon: -0.1276 });
      const first = await t.http.post('/v1/likes').set(a.auth).send({ targetId: b.id, action: 'like', comment: 'Love your hiking photo' }).expect(201);
      expect(first.body).toMatchObject({ matched: false });
      await t.http.post('/v1/likes').set(a.auth).send({ targetId: b.id, action: 'like' }).expect(409);

      const second = await t.http.post('/v1/likes').set(b.auth).send({ targetId: a.id, action: 'super_like' });
      // Free tier super likes: 1 per week.
      expect(second.status).toBe(201);
      expect(second.body).toMatchObject({ matched: true, matchId: expect.any(String), conversationId: expect.any(String) });

      const matches = (await t.http.get('/v1/matches').set(a.auth).expect(200)).body;
      expect(matches.items[0]).toMatchObject({ matchId: second.body.matchId, conversationId: second.body.conversationId, stage: 'matched', partner: { userId: b.id } });
      const members = await t.db.selectFrom('conversation_members').select('user_id').where('conversation_id', '=', second.body.conversationId).execute();
      expect(members.map((m) => m.user_id).sort()).toEqual([a.id, b.id].sort());

      await t.http.post(`/v1/matches/${second.body.matchId}/unmatch`).set(a.auth).send({}).expect(204);
      expect((await t.http.get('/v1/matches').set(b.auth).expect(200)).body.items).toHaveLength(0);
    });

    it('locks "who liked me" without the entitlement', async () => {
      const a = await discoverableUser(t, { gender: 'woman', seeking: ['man'], lat: 52.52, lon: 13.405 });
      const b = await discoverableUser(t, { gender: 'man', seeking: ['woman'], lat: 52.52, lon: 13.405 });
      await t.http.post('/v1/likes').set(a.auth).send({ targetId: b.id, action: 'like' }).expect(201);
      expect((await t.http.get('/v1/likes/received').set(b.auth).expect(200)).body).toMatchObject({ total: 1, locked: true, items: [] });
      await grant(t, b.id, 'see_who_liked');
      const unlocked = (await t.http.get('/v1/likes/received').set(b.auth).expect(200)).body;
      expect(unlocked.items[0].profile.userId).toBe(a.id);
    });

    it('meters likes on the free tier and lets premium rewind', async () => {
      const a = await discoverableUser(t, { gender: 'woman', seeking: ['man'], lat: 40.4168, lon: -3.7038 });
      const targets = [await discoverableUser(t, { gender: 'man', seeking: ['woman'], lat: 40.4168, lon: -3.7038 }), await discoverableUser(t, { gender: 'man', seeking: ['woman'], lat: 40.4168, lon: -3.7038 })];
      await t.db.updateTable('free_tier_limits').set({ limit_value: 1 }).where('entitlement_key', '=', 'likes').execute();
      try {
        await t.http.post('/v1/likes').set(a.auth).send({ targetId: targets[0]!.id, action: 'like' }).expect(201);
        expect((await t.http.post('/v1/likes').set(a.auth).send({ targetId: targets[1]!.id, action: 'like' }).expect(429)).body.error.code).toBe('LIMIT_REACHED');
        await t.http.post('/v1/likes').set(a.auth).send({ targetId: targets[1]!.id, action: 'pass' }).expect(201); // passes are free

        expect((await t.http.post('/v1/likes/rewind').set(a.auth).expect(429)).body.error.code).toBe('LIMIT_REACHED'); // free tier: 0 rewinds
        await grant(t, a.id, 'rewind');
        expect((await t.http.post('/v1/likes/rewind').set(a.auth).expect(200)).body).toMatchObject({ rewoundTargetId: targets[1]!.id, action: 'pass' });
        await t.http.post('/v1/likes').set(a.auth).send({ targetId: targets[1]!.id, action: 'pass' }).expect(201);
      } finally {
        await t.db.updateTable('free_tier_limits').set({ limit_value: 50 }).where('entitlement_key', '=', 'likes').execute();
      }
    });
  });

  describe('liked profiles & favourites', () => {
    it('lists the profiles I liked, newest first, with match state, and hides blocked ones', async () => {
      const me = await discoverableUser(t, { gender: 'woman', seeking: ['man'], lat: 40.4168, lon: -3.7038 });
      const b = await discoverableUser(t, { gender: 'man', seeking: ['woman'], lat: 40.4168, lon: -3.7038 });
      const c = await discoverableUser(t, { gender: 'man', seeking: ['woman'], lat: 40.4168, lon: -3.7038 });
      const d = await discoverableUser(t, { gender: 'man', seeking: ['woman'], lat: 40.4168, lon: -3.7038 });
      await t.http.post('/v1/likes').set(me.auth).send({ targetId: b.id, action: 'like' }).expect(201);
      await t.http.post('/v1/likes').set(me.auth).send({ targetId: c.id, action: 'super_like' }).expect(201);
      await t.http.post('/v1/likes').set(me.auth).send({ targetId: d.id, action: 'pass' }).expect(201);
      const match = (await t.http.post('/v1/likes').set(b.auth).send({ targetId: me.id, action: 'like' }).expect(201)).body;

      const sent = (await t.http.get('/v1/likes/sent').set(me.auth).expect(200)).body;
      expect(sent.items.map((i: { profile: { userId: string } }) => i.profile.userId)).toEqual([c.id, b.id]); // passes excluded
      expect(sent.items[0]).toMatchObject({ superLike: true, matched: false, matchId: null, favorited: false });
      expect(sent.items[1]).toMatchObject({ superLike: false, matched: true, matchId: match.matchId, conversationId: match.conversationId });

      await t.http.post('/v1/blocks').set(c.auth).send({ userId: me.id }).expect((r) => expect([200, 201, 204]).toContain(r.status));
      expect((await t.http.get('/v1/likes/sent').set(me.auth).expect(200)).body.items.map((i: { profile: { userId: string } }) => i.profile.userId)).toEqual([b.id]);
    });

    it('adds, lists and removes favourites idempotently; flags them on the profile; never exposes them to the other person', async () => {
      const me = await discoverableUser(t, { gender: 'woman', seeking: ['man'], lat: 48.8566, lon: 2.3522 });
      const b = await discoverableUser(t, { gender: 'man', seeking: ['woman'], lat: 48.8566, lon: 2.3522 });
      await t.http.put(`/v1/favorites/${b.id}`).set(me.auth).expect(204);
      await t.http.put(`/v1/favorites/${b.id}`).set(me.auth).expect(204); // idempotent
      const list = (await t.http.get('/v1/favorites').set(me.auth).expect(200)).body;
      expect(list.items).toHaveLength(1);
      expect(list.items[0]).toMatchObject({ liked: false, matched: false, profile: { userId: b.id } });
      expect((await t.http.get(`/v1/profiles/${b.id}`).set(me.auth).expect(200)).body.favorited).toBe(true);
      expect((await t.http.get(`/v1/profiles/${me.id}`).set(b.auth).expect(200)).body.favorited).toBe(false);
      expect((await t.http.get('/v1/favorites').set(b.auth).expect(200)).body.items).toHaveLength(0);

      await t.http.delete(`/v1/favorites/${b.id}`).set(me.auth).expect(204);
      await t.http.delete(`/v1/favorites/${b.id}`).set(me.auth).expect(204); // idempotent
      expect((await t.http.get('/v1/favorites').set(me.auth).expect(200)).body.items).toHaveLength(0);
    });

    it('rejects self, unknown and blocked targets without revealing the block', async () => {
      const me = await discoverableUser(t, { gender: 'woman', seeking: ['man'], lat: 41.9028, lon: 12.4964 });
      const b = await discoverableUser(t, { gender: 'man', seeking: ['woman'], lat: 41.9028, lon: 12.4964 });
      await t.http.put(`/v1/favorites/${me.id}`).set(me.auth).expect(400);
      await t.http.put('/v1/favorites/00000000-0000-4000-8000-000000000000').set(me.auth).expect(404);
      await t.http.put(`/v1/favorites/${b.id}`).set(me.auth).expect(204);
      await t.http.post('/v1/blocks').set(b.auth).send({ userId: me.id }).expect((r) => expect([200, 201, 204]).toContain(r.status));
      expect((await t.http.get('/v1/favorites').set(me.auth).expect(200)).body.items).toHaveLength(0);
      await t.http.delete(`/v1/favorites/${b.id}`).set(me.auth).expect(204);
      await t.http.put(`/v1/favorites/${b.id}`).set(me.auth).expect(404);
    });
  });

  describe('search', () => {
    it('allows basic filters and requires advanced_filters for the rest', async () => {
      const u = await discoverableUser(t, { gender: 'woman', seeking: ['man'], lat: 41.3874, lon: 2.1686 });
      const other = await discoverableUser(t, { gender: 'man', seeking: ['woman'], lat: 41.3874, lon: 2.1686, interestKeys: ['surfing', 'yoga', 'coffee'] });
      const man = (await t.db.selectFrom('taxonomy_terms').select('id').where('kind', '=', 'gender').where('key', '=', 'man').executeTakeFirstOrThrow()).id;
      const res = await t.http.get(`/v1/search/users?genderIds=${man}&maxDistanceKm=10`).set(u.auth).expect(200);
      expect(res.body.items.map((c: Card) => c.userId)).toContain(other.id);
      const surfing = (await t.db.selectFrom('interests').select('id').where('key', '=', 'surfing').executeTakeFirstOrThrow()).id;
      await t.http.get(`/v1/search/users?interestIds=${surfing}`).set(u.auth).expect(402);
      await grant(t, u.id, 'advanced_filters');
      const adv = await t.http.get(`/v1/search/users?interestIds=${surfing}&maxDistanceKm=10`).set(u.auth).expect(200);
      expect(adv.body.items.map((c: Card) => c.userId)).toEqual([other.id]);
    });
  });

  describe('admin matching control', () => {
    it('versions configs, validates weights, publishes, and tests two users', async () => {
      const product = await adminSession(t, 'product_admin');
      const draft = await product.as(t.http.post('/v1/admin/matching/configs')).send({}).expect(201);
      const detail = (await product.as(t.http.get(`/v1/admin/matching/configs/${draft.body.id}`)).expect(200)).body;
      expect(detail.weights.relationship_intent).toBe(0.25);

      const toInput = (d: typeof detail, weights: Record<string, number>) => ({
        minCompatibility: Number(d.min_compatibility), candidatePoolLimit: d.candidate_pool_limit, recommendationBatchSize: d.recommendation_batch_size, dailyCuratedCount: d.daily_curated_count,
        behavioralWeight: Number(d.behavioral_weight), diversityMaxShare: Number(d.diversity_max_share), diversityDimensions: d.diversity_dimensions, repeatSuppressionDays: d.repeat_suppression_days,
        safetyExcludeThreshold: Number(d.safety_exclude_threshold), safetyDownrankThreshold: Number(d.safety_downrank_threshold), safetyDownrankFactor: Number(d.safety_downrank_factor),
        missingAnswerPolicy: d.missing_answer_policy, importanceMultipliers: d.importance_multipliers.map(Number), defaultImportance: d.default_importance, intentDefaultScore: Number(d.intent_default_score),
        minConfidence: Number(d.min_confidence), topFactorCount: d.top_factor_count, differenceThreshold: Number(d.difference_threshold), recommendationTtlHours: d.recommendation_ttl_hours,
        weights, rankingRules: d.rankingRules, intentMatrix: d.intentMatrix,
      });
      await product.as(t.http.put(`/v1/admin/matching/configs/${draft.body.id}`)).send(toInput(detail, { ...detail.weights, values: 0.5 })).expect(200);
      const bad = await product.as(t.http.post(`/v1/admin/matching/configs/${draft.body.id}/publish`)).send({}).expect(422);
      expect(bad.body.error.details.issues[0].code).toBe('weights_sum');

      const analyst = await adminSession(t, 'analyst');
      await analyst.as(t.http.post(`/v1/admin/matching/configs/${draft.body.id}/publish`)).send({}).expect(403);

      await product.as(t.http.put(`/v1/admin/matching/configs/${draft.body.id}`)).send(toInput(detail, { ...detail.weights, values: 0.1, personality: 0.25 })).expect(200);
      await product.as(t.http.post(`/v1/admin/matching/configs/${draft.body.id}/publish`)).send({}).expect(200);
      const list = (await product.as(t.http.get('/v1/admin/matching/configs')).expect(200)).body;
      expect(list[0]).toMatchObject({ id: draft.body.id, status: 'published' });
      expect(list[1].status).toBe('archived');

      const a = await discoverableUser(t, { gender: 'woman', seeking: ['man'], lat: -22.9068, lon: -43.1729 });
      const b = await discoverableUser(t, { gender: 'man', seeking: ['woman'], lat: -22.9068, lon: -43.1729 });
      const test = await product.as(t.http.post('/v1/admin/matching/test')).send({ userA: a.id, userB: b.id }).expect(200);
      expect(test.body).toMatchObject({ eligible: true, configVersionId: draft.body.id, result: { excluded: false, compatibility: expect.any(Number) } });
      expect(test.body.questions.find((q: { questionKey: string }) => q.questionKey === 'wants_children')).toMatchObject({ answeredA: true, answeredB: true, score: expect.any(Number) });
      expect(test.body.ranking.finalScore).toEqual(expect.any(Number));
      const access = await t.db.selectFrom('admin_data_access_logs').select('user_id').where('admin_user_id', '=', product.id).execute();
      expect(access.map((x) => x.user_id).sort()).toEqual([a.id, b.id].sort());
    });
  });
});
