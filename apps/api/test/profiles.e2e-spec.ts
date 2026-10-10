import sharp from 'sharp';
import { OBJECT_STORAGE, type InMemoryObjectStorage } from '../src/common/storage/object-storage';
import { OutboxService } from '../src/common/outbox/outbox.service';
import { activeUser, adminSession, answerRequired, bearer, createTestApp, drainOutbox, termId, type TestApp } from './helpers';

async function jpeg(seed: number, withSecretExif = false): Promise<Buffer> {
  // Deterministic but distinct images: a gradient tinted by the seed.
  const w = 640, h = 480;
  const raw = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    raw[i * 3] = (i % w) % 256;
    raw[i * 3 + 1] = (Math.floor(i / w) * seed) % 256;
    raw[i * 3 + 2] = (seed * 37) % 256;
  }
  let img = sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg();
  if (withSecretExif) img = img.withExif({ IFD0: { Copyright: 'secret-location-marker' } });
  return img.toBuffer();
}

describe('Profiles, media, onboarding, catalog (e2e)', () => {
  let t: TestApp;
  let storage: InMemoryObjectStorage;
  let outbox: OutboxService;

  beforeAll(async () => {
    t = await createTestApp();
    storage = t.app.get(OBJECT_STORAGE);
    outbox = t.app.get(OutboxService);
  });
  afterAll(() => t.close());

  async function uploadPhoto(auth: Record<string, string>, seed: number, exif = false): Promise<string> {
    const body = await jpeg(seed, exif);
    const up = await t.http.post('/v1/media/uploads').set(auth).send({ kind: 'photo', mimeType: 'image/jpeg', byteSize: body.length }).expect(201);
    const key = (await t.db.selectFrom('profile_media').select('storage_key').where('id', '=', up.body.mediaId).executeTakeFirstOrThrow()).storage_key;
    await storage.put(key, body, 'image/jpeg');
    await t.http.post(`/v1/media/${up.body.mediaId}/confirm`).set(auth).send({}).expect(200);
    await drainOutbox(t);
    return up.body.mediaId;
  }

  async function buildCompleteProfile(auth: Record<string, string>, userId: string) {
    const hyd = await t.db.selectFrom('cities').select('id').where('name', '=', 'Hyderabad').executeTakeFirstOrThrow();
    await t.http.put('/v1/profiles/me').set(auth).send({
      displayName: 'Asha', bio: 'Loves hiking, filter coffee and long conversations.', cityId: hyd.id,
      genderId: await termId(t, 'gender', 'woman'), datingIntentId: await termId(t, 'dating_intent', 'long_term'), relationshipGoalId: await termId(t, 'relationship_goal', 'committed'),
      orientationId: await termId(t, 'orientation', 'straight'),
    }).expect(200);
    await t.http.put('/v1/preferences').set(auth).send({ terms: { gender: [{ termId: await termId(t, 'gender', 'man'), isDealbreaker: false }] } }).expect(200);
    const interests = await t.db.selectFrom('interests').select('id').limit(4).execute();
    await t.http.put('/v1/profiles/me/interests').set(auth).send({ interestIds: interests.map((i) => i.id) }).expect(200);
    await uploadPhoto(auth, userId.charCodeAt(0) + 1);
    await uploadPhoto(auth, userId.charCodeAt(1) + 2);
  }

  describe('catalog & config', () => {
    it('serves localized taxonomy with English fallback', async () => {
      const res = await t.http.get('/v1/catalog/taxonomy?kinds=gender,dating_intent&locale=pt-BR').expect(200);
      expect(res.body.find((x: { key: string }) => x.key === 'long_term')).toMatchObject({ kind: 'dating_intent', label: 'Long-term relationship' });
      await t.http.get('/v1/catalog/taxonomy?kinds=not_a_kind').expect(400);
    });

    it('serves interests grouped by category, prompts and city search', async () => {
      const interests = await t.http.get('/v1/catalog/interests').expect(200);
      expect(interests.body.length).toBeGreaterThan(5);
      expect(interests.body[0].interests.length).toBeGreaterThan(0);
      expect((await t.http.get('/v1/catalog/prompts').expect(200)).body.length).toBeGreaterThan(5);
      const cities = await t.http.get('/v1/catalog/cities?country=IN&q=hyd').expect(200);
      expect(cities.body[0].name).toBe('Hyderabad');
    });

    it('evaluates feature flags with targeting rules', async () => {
      const admin = await adminSession(t, 'product_admin');
      await admin.as(t.http.put('/v1/admin/config/flags/test.country_only')).send({ key: 'test.country_only', enabled: true, defaultValue: false, rules: [{ ruleType: 'country', countryCodes: ['IN'], value: true }] }).expect(200);
      expect((await t.http.get('/v1/config?country=IN').expect(200)).body.flags['test.country_only']).toBe(true);
      expect((await t.http.get('/v1/config?country=US').expect(200)).body.flags['test.country_only']).toBe(false);
      const bad = await admin.as(t.http.put('/v1/admin/config/flags/test.bad')).send({ key: 'test.bad', enabled: true, defaultValue: false, rules: [{ ruleType: 'country', value: true }] }).expect(400);
      expect(bad.body.error.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('own profile', () => {
    it('requires a display name to create a profile and validates taxonomy kinds', async () => {
      const u = await activeUser(t);
      expect((await t.http.get('/v1/profiles/me').set(u.auth).expect(200)).body.exists).toBe(false);
      await t.http.put('/v1/profiles/me').set(u.auth).send({ bio: 'hello' }).expect(400);
      const wrongKind = await t.http.put('/v1/profiles/me').set(u.auth).send({ displayName: 'A', genderId: await termId(t, 'dating_intent', 'long_term') }).expect(400);
      expect(wrongKind.body.error.code).toBe('VALIDATION_FAILED');
      const ok = await t.http.put('/v1/profiles/me').set(u.auth).send({ displayName: 'Asha', genderId: await termId(t, 'gender', 'woman') }).expect(200);
      expect(ok.body).toMatchObject({ exists: true, displayName: 'Asha', gender: { key: 'woman', label: 'Woman' } });
    });

    it('enforces single-select attributes and allows multi-select ones', async () => {
      const u = await activeUser(t);
      await t.http.put('/v1/profiles/me').set(u.auth).send({ displayName: 'B' }).expect(200);
      const bad = await t.http.put('/v1/profiles/me/attributes').set(u.auth).send({ attributes: { lifestyle_drinking: [await termId(t, 'lifestyle_drinking', 'never'), await termId(t, 'lifestyle_drinking', 'socially')] } }).expect(400);
      expect(bad.body.error.message).toMatch(/single/);
      const ok = await t.http.put('/v1/profiles/me/attributes').set(u.auth).send({ attributes: { pets: [await termId(t, 'pets', 'dog'), await termId(t, 'pets', 'cat')] } }).expect(200);
      expect(ok.body.attributes.pets).toHaveLength(2);
    });

    it('stores prompts and languages and raises completeness', async () => {
      const u = await activeUser(t);
      await t.http.put('/v1/profiles/me').set(u.auth).send({ displayName: 'C' }).expect(200);
      const prompt = await t.db.selectFrom('prompt_catalog').select('id').where('key', '=', 'ideal_sunday').executeTakeFirstOrThrow();
      const before = (await t.http.get('/v1/profiles/me').set(u.auth)).body.completeness;
      const res = await t.http.put('/v1/profiles/me/prompts').set(u.auth).send({ prompts: [{ promptId: prompt.id, answer: 'Long walks and dosa' }] }).expect(200);
      expect(res.body.prompts[0]).toMatchObject({ answer: 'Long walks and dosa', moderationStatus: 'pending' });
      await t.http.put('/v1/profiles/me/languages').set(u.auth).send({ languages: [{ code: 'te', proficiency: 'native' }] }).expect(200);
      expect((await t.http.get('/v1/profiles/me').set(u.auth)).body.completeness).toBeGreaterThan(before);
    });

    it('gates incognito and advanced filters behind entitlements (server-side)', async () => {
      const u = await activeUser(t);
      await t.http.put('/v1/profiles/me').set(u.auth).send({ displayName: 'D' }).expect(200);
      expect((await t.http.put('/v1/profiles/me/privacy').set(u.auth).send({ incognito: true }).expect(402)).body.error.details.entitlement).toBe('incognito');
      const adv = await t.http.put('/v1/preferences').set(u.auth).send({ verifiedOnly: true }).expect(402);
      expect(adv.body.error.details.entitlement).toBe('advanced_filters');

      await t.db.insertInto('entitlements').values([
        { user_id: u.id, entitlement_key: 'incognito', source_type: 'admin_grant' },
        { user_id: u.id, entitlement_key: 'advanced_filters', source_type: 'admin_grant' },
      ]).execute();
      expect((await t.http.put('/v1/profiles/me/privacy').set(u.auth).send({ incognito: true }).expect(200)).body.incognito).toBe(true);
      expect((await t.http.put('/v1/preferences').set(u.auth).send({ verifiedOnly: true, ageMin: 25, ageMax: 35 }).expect(200)).body).toMatchObject({ verifiedOnly: true, ageMin: 25, ageMax: 35 });
      await t.http.put('/v1/preferences').set(u.auth).send({ ageMin: 40 }).expect(400);
    });
  });

  describe('location privacy', () => {
    it('requires consent and only publishes a coarse cell and city', async () => {
      const u = await activeUser(t);
      await t.http.put('/v1/profiles/me').set(u.auth).send({ displayName: 'E' }).expect(200);
      const denied = await t.http.put('/v1/location').set(u.auth).send({ latitude: 17.4126, longitude: 78.4071, source: 'gps' }).expect(400);
      expect(denied.body.error.code).toBe('CONSENT_REQUIRED');
      await t.http.post('/v1/users/me/consents').set(u.auth).send({ consentType: 'location', granted: true }).expect(200);
      const res = await t.http.put('/v1/location').set(u.auth).send({ latitude: 17.4126, longitude: 78.4071, source: 'gps' }).expect(200);
      expect(res.body).toEqual({ cityId: expect.any(String), cityName: 'Hyderabad' });
      const p = await t.db.selectFrom('user_profiles').select('geohash5').where('user_id', '=', u.id).executeTakeFirstOrThrow();
      expect(p.geohash5).toHaveLength(5);
    });
  });

  describe('media', () => {
    it('validates type, requires the object, strips metadata and builds a thumbnail', async () => {
      const u = await activeUser(t);
      await t.http.put('/v1/profiles/me').set(u.auth).send({ displayName: 'F' }).expect(200);
      expect((await t.http.post('/v1/media/uploads').set(u.auth).send({ kind: 'photo', mimeType: 'application/pdf', byteSize: 10 }).expect(415)).body.error.code).toBe('MEDIA_TYPE_NOT_ALLOWED');
      expect((await t.http.post('/v1/media/uploads').set(u.auth).send({ kind: 'photo', mimeType: 'image/jpeg', byteSize: 50 * 1024 * 1024 }).expect(413)).body.error.code).toBe('MEDIA_TOO_LARGE');

      const up = await t.http.post('/v1/media/uploads').set(u.auth).send({ kind: 'photo', mimeType: 'image/jpeg', byteSize: 500_000 }).expect(201);
      expect(up.body.uploadUrl).toMatch(/^memory:\/\/upload\//);
      expect((await t.http.post(`/v1/media/${up.body.mediaId}/confirm`).set(u.auth).send({}).expect(409)).body.error.code).toBe('MEDIA_NOT_UPLOADED');

      const id = await uploadPhoto(u.auth, 7, true);
      const row = await t.db.selectFrom('profile_media').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
      // No image-moderation provider in tests and auto-approve off → routed to human review.
      expect(row).toMatchObject({ processing_status: 'ready', moderation_status: 'needs_review', mime_type: 'image/jpeg' });
      expect(row.perceptual_hash).toHaveLength(8);
      const stored = await storage.get(row.storage_key);
      expect((await sharp(stored).metadata()).exif).toBeUndefined();
      expect(storage.objects.has((row.variants as { thumb: string }).thumb)).toBe(true);
    });

    it('flags duplicate photos across accounts as a safety signal', async () => {
      const a = await activeUser(t);
      const b = await activeUser(t);
      await t.http.put('/v1/profiles/me').set(a.auth).send({ displayName: 'G' }).expect(200);
      await t.http.put('/v1/profiles/me').set(b.auth).send({ displayName: 'H' }).expect(200);
      await uploadPhoto(a.auth, 99);
      await uploadPhoto(b.auth, 99);
      const ev = await t.db.selectFrom('safety_events').select(['signal']).where('user_id', '=', b.id).execute();
      expect(ev.map((e) => e.signal)).toContain('duplicate_account');
    });

    it('reorders, deletes and purges storage', async () => {
      const u = await activeUser(t);
      await t.http.put('/v1/profiles/me').set(u.auth).send({ displayName: 'I' }).expect(200);
      const a = await uploadPhoto(u.auth, 11);
      const b = await uploadPhoto(u.auth, 12);
      const list = await t.http.put('/v1/media/order').set(u.auth).send({ mediaIds: [b, a] }).expect(200);
      expect(list.body.map((m: { id: string }) => m.id)).toEqual([b, a]);
      const key = (await t.db.selectFrom('profile_media').select('storage_key').where('id', '=', a).executeTakeFirstOrThrow()).storage_key;
      await t.http.delete(`/v1/media/${a}`).set(u.auth).expect(204);
      await drainOutbox(t);
      expect(storage.objects.has(key)).toBe(false);
      const other = await activeUser(t);
      await t.http.delete(`/v1/media/${b}`).set(other.auth).expect(404);
    });
  });

  describe('onboarding & discoverability', () => {
    it('drives steps from the admin flow, validates data-backed steps and completes', async () => {
      const u = await activeUser(t);
      const initial = await t.http.get('/v1/onboarding').set(u.auth).expect(200);
      expect(initial.body.currentStep).toBe('profile_basics');
      expect(initial.body.canComplete).toBe(false);

      const invalid = await t.http.put('/v1/onboarding/step').set(u.auth).send({ step: 'interests', complete: true }).expect(400);
      expect(invalid.body.error.details.reason).toBe('onboarding.missing.interests');
      const draft = await t.http.put('/v1/onboarding/step').set(u.auth).send({ step: 'interests', complete: false, draft: { selected: 2 } }).expect(200);
      expect(draft.body.draft).toEqual({ selected: 2 });

      await buildCompleteProfile(u.auth, u.id);
      await answerRequired(t, u.auth);
      await t.http.put('/v1/onboarding/step').set(u.auth).send({ step: 'questionnaire', complete: true }).expect(200);
      const done = await t.http.post('/v1/onboarding/complete').set(u.auth).expect(200);
      expect(done.body.completedAt).toEqual(expect.any(String));

      // Photos are pending moderation, so the profile is not yet discoverable.
      let p = await t.http.get('/v1/profiles/me').set(u.auth).expect(200);
      expect(p.body.discoverable).toBe(false);
      await t.db.updateTable('profile_media').set({ moderation_status: 'approved' }).where('user_id', '=', u.id).execute();
      await t.http.put('/v1/profiles/me').set(u.auth).send({}).expect(200); // triggers recompute
      p = await t.http.get('/v1/profiles/me').set(u.auth).expect(200);
      expect(p.body.discoverable).toBe(true);
    });

    it('lets others view a discoverable profile with privacy filtering, and hides it when blocked', async () => {
      const subject = await activeUser(t);
      await buildCompleteProfile(subject.auth, subject.id);
      await answerRequired(t, subject.auth);
      await t.http.put('/v1/onboarding/step').set(subject.auth).send({ step: 'questionnaire', complete: true }).expect(200);
      await t.http.post('/v1/onboarding/complete').set(subject.auth).expect(200);
      const viewer = await activeUser(t);

      await t.http.get(`/v1/profiles/${subject.id}`).set(viewer.auth).expect(404); // photos not approved yet → not discoverable

      await t.db.updateTable('profile_media').set({ moderation_status: 'approved' }).where('user_id', '=', subject.id).execute();
      await t.http.put('/v1/profiles/me').set(subject.auth).send({}).expect(200);
      const res = await t.http.get(`/v1/profiles/${subject.id}?surface=swipe`).set(viewer.auth).expect(200);
      expect(res.body).toMatchObject({ displayName: 'Asha', city: 'Hyderabad', orientation: null, matched: false });
      expect(res.body.media).toHaveLength(2);
      expect(JSON.stringify(res.body)).not.toMatch(/latitude|longitude|geohash|storage_key|moderation/);

      await t.db.insertInto('blocks').values({ blocker_id: subject.id, blocked_id: viewer.id }).execute();
      await t.http.get(`/v1/profiles/${subject.id}`).set(viewer.auth).expect(404);
    });
  });

  describe('admin configuration', () => {
    it('manages taxonomy with immutable keys and RBAC', async () => {
      const admin = await adminSession(t, 'product_admin');
      const created = await admin.as(t.http.post('/v1/admin/taxonomy/terms')).send({ kind: 'travel_style', key: 'slow_travel', translations: { en: { label: 'Slow travel' }, es: { label: 'Viaje lento' } } }).expect(201);
      const es = await t.http.get('/v1/catalog/taxonomy?kinds=travel_style&locale=es').expect(200);
      expect(es.body.find((x: { key: string }) => x.key === 'slow_travel').label).toBe('Viaje lento');
      await admin.as(t.http.put(`/v1/admin/taxonomy/terms/${created.body.id}`)).send({ kind: 'travel_style', key: 'renamed', translations: { en: { label: 'x' } } }).expect(409);
      await admin.as(t.http.post('/v1/admin/taxonomy/terms')).send({ kind: 'travel_style', key: 'slow_travel', translations: { en: { label: 'dup' } } }).expect(409);
      await admin.as(t.http.post('/v1/admin/taxonomy/terms')).send({ kind: 'travel_style', key: 'no_en', translations: { es: { label: 'x' } } }).expect(400);

      const analyst = await adminSession(t, 'analyst');
      await analyst.as(t.http.post('/v1/admin/taxonomy/terms')).send({ kind: 'travel_style', key: 'nope', translations: { en: { label: 'x' } } }).expect(403);

      const audit = await t.db.selectFrom('audit_logs').select('action').where('actor_id', '=', admin.id).execute();
      expect(audit.map((a) => a.action)).toContain('taxonomy.term_created');
    });

    it('publishes CMS content and new legal versions', async () => {
      const content = await adminSession(t, 'content_admin');
      await content.as(t.http.put('/v1/admin/content/cms/faq.test_entry')).send({
        key: 'faq.test_entry', kind: 'faq', status: 'published', countryCodes: ['IN'], translations: { en: { title: 'Q?', bodyMarkdown: 'A.' } },
      }).expect(200);
      expect((await t.http.get('/v1/content?kind=faq&country=IN').expect(200)).body.map((e: { key: string }) => e.key)).toContain('faq.test_entry');
      expect((await t.http.get('/v1/content?kind=faq&country=US').expect(200)).body.map((e: { key: string }) => e.key)).not.toContain('faq.test_entry');

      const draft = await content.as(t.http.post('/v1/admin/content/legal')).send({ docType: 'terms', locale: 'en', title: 'Terms v2', bodyMarkdown: '# Terms v2' }).expect(201);
      expect(draft.body).toMatchObject({ version: 2, status: 'draft' });
      await content.as(t.http.post(`/v1/admin/content/legal/${draft.body.id}/publish`)).send({}).expect(200);
      expect((await t.http.get('/v1/legal/terms').expect(200)).body).toMatchObject({ id: draft.body.id, version: 2 });
    });

    it('validates typed settings', async () => {
      const sa = await adminSession(t, 'super_admin');
      await sa.as(t.http.put('/v1/admin/config/settings/onboarding.min_interests')).send({ value: 'three', valueType: 'number' }).expect(400);
      await sa.as(t.http.put('/v1/admin/config/settings/onboarding.min_interests')).send({ value: 3, valueType: 'number' }).expect(200);
    });
  });

  describe('client analytics', () => {
    it('accepts allow-listed events and rejects server-only or unknown names', async () => {
      const u = await activeUser(t);
      const res = await t.http.post('/v1/analytics/events').set(bearer(u.token)).send({
        platform: 'ios',
        events: [
          { name: 'paywall_viewed', occurredAt: new Date().toISOString(), properties: { source: 'likes' } },
          { name: 'match_created', occurredAt: new Date().toISOString(), properties: {} },
          { name: 'made_up_event', occurredAt: new Date().toISOString(), properties: {} },
        ],
      }).expect(202);
      expect(res.body).toEqual({ accepted: 1, rejected: 2 });
    });
  });
});
