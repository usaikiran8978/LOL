import 'reflect-metadata';
import { Algorithm, hash } from '@node-rs/argon2';
import { sql } from 'kysely';
import sharp from 'sharp';
import request from 'supertest';
import { createApp } from '../src/bootstrap';
import { loadConfig } from '../src/common/config/config';
import { DATABASE, type Database } from '../src/common/db/database';
import { DevMessageSink } from '../src/common/messaging/messaging';
import { OBJECT_STORAGE, type ObjectStorage } from '../src/common/storage/object-storage';

/**
 * Demo data for local development and walkthroughs: one admin per role and a small community of complete member
 * profiles (photos, questionnaire, preferences, location) with matches and a few chats. Members are created through
 * the real HTTP API, so they pass the same validation as real sign-ups. Idempotent: existing demo accounts are kept.
 *
 *   node --env-file=.env -r @swc-node/register scripts/seed-demo.ts
 *
 * Refuses to run in production. Passwords are printed at the end and are for local use only.
 */
export const DEMO_ADMIN_PASSWORD = 'AmoraAdmin#2026';
export const DEMO_MEMBER_PASSWORD = 'AmoraMember#2026';

const ADMINS: Array<[role: string, name: string]> = [
  ['super_admin', 'Demo Super Admin'], ['trust_safety', 'Demo Trust & Safety'], ['support', 'Demo Support'], ['product_admin', 'Demo Product'],
  ['finance_admin', 'Demo Finance'], ['analyst', 'Demo Analyst'], ['content_admin', 'Demo Content'],
];

interface Member { key: string; name: string; gender: 'woman' | 'man'; seeking: Array<'woman' | 'man'>; age: number; city: string; bio: string; interests: string[]; intent: string; colors: [string, string] }

const MEMBERS: Member[] = [
  { key: 'alex', name: 'Alex', gender: 'man', seeking: ['woman'], age: 31, city: 'London', bio: 'Product designer who cooks too much pasta. Weekend hikes, Sunday markets, terrible puns.', interests: ['hiking', 'cooking', 'coffee', 'photography'], intent: 'long_term', colors: ['#2563eb', '#7c3aed'] },
  { key: 'sara', name: 'Sara', gender: 'woman', seeking: ['man'], age: 29, city: 'London', bio: 'Paediatric nurse, amateur potter, always up for live music and a long walk after.', interests: ['live_music', 'hiking', 'coffee', 'painting'], intent: 'long_term', colors: ['#db2777', '#f59e0b'] },
  { key: 'maya', name: 'Maya', gender: 'woman', seeking: ['man'], age: 27, city: 'London', bio: 'Data scientist by day, salsa dancer by night. Looking for someone curious and kind.', interests: ['dancing', 'reading', 'coffee', 'travel_photography'], intent: 'long_term', colors: ['#059669', '#0ea5e9'] },
  { key: 'leila', name: 'Leila', gender: 'woman', seeking: ['man'], age: 33, city: 'London', bio: 'Architect. I collect cookbooks and plan trips I may never take. Tea over coffee, fight me.', interests: ['cooking', 'museums', 'reading', 'yoga'], intent: 'long_term', colors: ['#9333ea', '#f43f5e'] },
  { key: 'zoe', name: 'Zoe', gender: 'woman', seeking: ['man'], age: 26, city: 'London', bio: 'Climbing wall regular, board game host, chronic overplanner of weekends.', interests: ['climbing', 'board_games', 'gaming', 'coffee'], intent: 'figuring_out', colors: ['#ea580c', '#facc15'] },
  { key: 'priya', name: 'Priya', gender: 'woman', seeking: ['man'], age: 30, city: 'London', bio: 'Lawyer who unwinds with yoga and cricket. Will judge your chai recipe.', interests: ['yoga', 'cricket', 'cooking', 'movies'], intent: 'long_term', colors: ['#0d9488', '#6366f1'] },
  { key: 'emma', name: 'Emma', gender: 'woman', seeking: ['man'], age: 34, city: 'London', bio: 'Teacher, half-marathon runner, Sunday roast enthusiast.', interests: ['running', 'cooking', 'theatre', 'reading'], intent: 'long_term', colors: ['#be123c', '#fb923c'] },
  { key: 'noah', name: 'Noah', gender: 'man', seeking: ['woman'], age: 32, city: 'London', bio: 'Chef turned software engineer. I still bake bread every weekend.', interests: ['baking', 'cycling', 'live_music', 'coffee'], intent: 'long_term', colors: ['#1d4ed8', '#14b8a6'] },
  { key: 'omar', name: 'Omar', gender: 'man', seeking: ['woman'], age: 28, city: 'London', bio: 'Football on Saturdays, museums on Sundays. Learning Spanish, badly.', interests: ['football', 'museums', 'movies', 'street_food'], intent: 'long_term', colors: ['#4338ca', '#22c55e'] },
  { key: 'liam', name: 'Liam', gender: 'man', seeking: ['woman'], age: 35, city: 'London', bio: 'Photographer. Ask me about the best sunrise spots in the city.', interests: ['photography', 'hiking', 'wine', 'concerts'], intent: 'long_term', colors: ['#0f766e', '#a855f7'] },
  { key: 'ana', name: 'Ana', gender: 'woman', seeking: ['man'], age: 28, city: 'Madrid', bio: 'UX researcher. Tapas expert. Looking for someone to explore new cities with.', interests: ['street_food', 'museums', 'dancing', 'photography'], intent: 'long_term', colors: ['#c026d3', '#f97316'] },
  { key: 'ravi', name: 'Ravi', gender: 'man', seeking: ['woman'], age: 30, city: 'Bengaluru', bio: 'Startup founder, weekend trekker, filter coffee loyalist.', interests: ['hiking', 'coffee', 'podcasts', 'cricket'], intent: 'long_term', colors: ['#16a34a', '#0284c7'] },
];

/** Who likes whom (mutual likes become matches) and the chats to start. */
const LIKES: Array<[from: string, to: string]> = [
  ['alex', 'sara'], ['sara', 'alex'], ['alex', 'maya'], ['maya', 'alex'], ['leila', 'alex'], ['zoe', 'alex'], ['noah', 'sara'], ['omar', 'sara'],
];
const CHATS: Array<{ pair: [string, string]; messages: Array<[from: string, text: string]> }> = [
  { pair: ['alex', 'sara'], messages: [['alex', 'Hi Sara! A potter who loves live music — what was the last gig you went to?'], ['sara', 'Hey Alex! Saw a jazz trio in Camden last week, it was magic. Any hike you would recommend near London?'], ['alex', 'Box Hill is lovely this time of year. Coffee after, obviously.']] },
  { pair: ['alex', 'maya'], messages: [['maya', 'Your pasta claim needs verification 😄'], ['alex', 'I accept the challenge. Carbonara, no cream.']] },
];

function photoSvg(name: string, [a, b]: [string, string], variant: number) {
  const angle = variant === 0 ? '0 0 1 1' : '1 0 0 1';
  const [x1, y1, x2, y2] = angle.split(' ');
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000">
  <defs><linearGradient id="g" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
  <rect width="800" height="1000" fill="url(#g)"/>
  <circle cx="400" cy="420" r="210" fill="rgba(255,255,255,0.18)"/>
  <text x="400" y="500" font-family="Helvetica, Arial, sans-serif" font-size="240" font-weight="700" fill="#fff" text-anchor="middle">${name[0]}</text>
  <text x="400" y="860" font-family="Helvetica, Arial, sans-serif" font-size="64" fill="rgba(255,255,255,0.9)" text-anchor="middle">${name} · demo ${variant + 1}</text>
</svg>`);
}

async function main() {
  const cfg = loadConfig({
    ...process.env,
    // Seeding is one process acting for many accounts: the per-IP limits and OTP caps would otherwise block it.
    RATE_LIMIT_ENABLED: 'false', OTP_MAX_PER_HOUR: '1000', OTP_RESEND_COOLDOWN_SECONDS: '0', WORKERS_ENABLED: 'false',
  });
  if (cfg.NODE_ENV === 'production') throw new Error('seed-demo refuses to run in production');
  if (cfg.EMAIL_PROVIDER !== 'dev') throw new Error('seed-demo needs EMAIL_PROVIDER=dev (it reads verification codes from the dev sink)');
  const app = await createApp(cfg);
  await app.init();
  const http = request(app.getHttpServer());
  const db = app.get<Database>(DATABASE);
  const sink = app.get(DevMessageSink);
  const storage = app.get<ObjectStorage>(OBJECT_STORAGE);
  const term = async (kind: string, key: string) => (await db.selectFrom('taxonomy_terms').select('id').where('kind', '=', kind).where('key', '=', key).executeTakeFirstOrThrow()).id;
  const ok = (r: request.Response, ...codes: number[]) => {
    if (!codes.includes(r.status)) throw new Error(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
    return r;
  };

  // ------------------------------------------------------------------ admins
  const adminHash = await hash(DEMO_ADMIN_PASSWORD, { algorithm: Algorithm.Argon2id });
  const adminRows: Array<{ email: string; role: string }> = [];
  for (const [role, name] of ADMINS) {
    const email = `${role.replace(/_/g, '.')}@demo.amora.dev`;
    adminRows.push({ email, role });
    if (await db.selectFrom('admin_users').select('id').where('email', '=', email).executeTakeFirst()) continue;
    const r = await db.selectFrom('admin_roles').select('id').where('key', '=', role).executeTakeFirstOrThrow();
    const a = await db.insertInto('admin_users').values({ email, display_name: name, password_hash: adminHash, status: 'active' }).returning('id').executeTakeFirstOrThrow();
    await db.insertInto('admin_user_roles').values({ admin_user_id: a.id, role_id: r.id }).execute();
  }

  // ------------------------------------------------------------------ members
  const terms = ok(await http.get('/v1/legal/terms'), 200).body.id as string;
  const privacy = ok(await http.get('/v1/legal/privacy'), 200).body.id as string;
  const ids = new Map<string, { id: string; auth: Record<string, string> }>();
  const login = async (email: string) => {
    const r = ok(await http.post('/v1/auth/login').send({ identifier: email, password: DEMO_MEMBER_PASSWORD, device: { installationId: 'seed-demo-script', platform: 'ios' } }), 200);
    return { id: r.body.user.id as string, auth: { Authorization: `Bearer ${r.body.tokens.accessToken}` } };
  };

  for (const m of MEMBERS) {
    const email = `${m.key}@demo.amora.dev`;
    const existing = await db.selectFrom('users').select('id').where('email', '=', email).executeTakeFirst();
    if (existing) {
      ids.set(m.key, await login(email));
      continue;
    }
    const city = await db.selectFrom('cities').select(['id', 'country_code', 'latitude', 'longitude']).where('name', '=', m.city).executeTakeFirstOrThrow();
    const dob = new Date();
    dob.setUTCFullYear(dob.getUTCFullYear() - m.age, 4, 15);
    const reg = ok(await http.post('/v1/auth/register').send({
      email, password: DEMO_MEMBER_PASSWORD, dateOfBirth: dob.toISOString().slice(0, 10), countryCode: city.country_code, locale: 'en',
      acceptedTermsVersionId: terms, acceptedPrivacyVersionId: privacy, confirmsMinimumAge: true, device: { installationId: `seed-demo-${m.key}`, platform: 'ios' },
    }), 201);
    const auth = { Authorization: `Bearer ${reg.body.tokens.accessToken}` };
    const code = sink.lastTo(email)!.match(/\b(\d{6})\b/)![1];
    ok(await http.post('/v1/auth/verification/confirm').set(auth).send({ channel: 'email', code }), 200);
    const uid = reg.body.user.id as string;

    ok(await http.put('/v1/profiles/me').set(auth).send({
      displayName: m.name, bio: m.bio, cityId: city.id, genderId: await term('gender', m.gender),
      datingIntentId: await term('dating_intent', m.intent), relationshipGoalId: await term('relationship_goal', 'committed'),
    }), 200);
    ok(await http.post('/v1/users/me/consents').set(auth).send({ consentType: 'location', granted: true }), 200);
    // Small offsets so members in one city are at slightly different distances.
    const jitter = (MEMBERS.indexOf(m) % 5) * 0.004;
    ok(await http.put('/v1/location').set(auth).send({ latitude: Number(city.latitude) + jitter, longitude: Number(city.longitude) - jitter, source: 'gps' }), 200);
    ok(await http.put('/v1/preferences').set(auth).send({
      ageMin: 21, ageMax: 45, maxDistanceKm: 50,
      terms: { gender: await Promise.all(m.seeking.map(async (g) => ({ termId: await term('gender', g), isDealbreaker: false }))) },
    }), 200);
    const interests = await db.selectFrom('interests').select('id').where('key', 'in', m.interests).execute();
    ok(await http.put('/v1/profiles/me/interests').set(auth).send({ interestIds: interests.map((i) => i.id) }), 200);

    for (let i = 0; i < 2; i++) {
      const key = `profiles/${uid}/demo-${i}.jpg`;
      const jpg = await sharp(photoSvg(m.name, m.colors, i)).jpeg({ quality: 82 }).toBuffer();
      await storage.put(key, jpg, 'image/jpeg');
      await db.insertInto('profile_media').values({ user_id: uid, kind: 'photo', storage_key: key, mime_type: 'image/jpeg', byte_size: jpg.length, width: 800, height: 1000, position: i, processing_status: 'ready', moderation_status: 'approved' }).execute();
    }

    const qs = ok(await http.get('/v1/questions').set(auth), 200).body as Array<{ questionId: string; versionId: string; answerType: string; isRequired: boolean; options: Array<{ key: string }>; constraints: { scaleMin: number; scaleMax: number } }>;
    for (const [i, q] of qs.filter((x) => x.isRequired).entries()) {
      const pick = q.options.length ? q.options[(i + MEMBERS.indexOf(m)) % Math.min(2, q.options.length)]!.key : null;
      const value =
        q.answerType === 'scale' ? { value: Math.round((q.constraints.scaleMin + q.constraints.scaleMax) / 2) }
        : q.answerType === 'multiple_choice' ? { optionKeys: [pick!] }
        : q.answerType === 'ranking' ? { rankedOptionKeys: q.options.map((o) => o.key) }
        : { optionKey: pick! };
      ok(await http.post('/v1/answers').set(auth).send({ questionId: q.questionId, versionId: q.versionId, value }), 201);
    }
    ok(await http.put('/v1/onboarding/step').set(auth).send({ step: 'questionnaire', complete: true }), 200);
    ok(await http.post('/v1/onboarding/complete').set(auth), 200);
    ok(await http.put('/v1/profiles/me').set(auth).send({}), 200);
    ids.set(m.key, { id: uid, auth });
  }

  // ------------------------------------------------------------------ likes, matches, chats
  for (const [from, to] of LIKES) {
    const a = ids.get(from)!; const b = ids.get(to)!;
    const done = await db.selectFrom('swipe_actions').select('id').where('actor_id', '=', a.id).where('target_id', '=', b.id).executeTakeFirst();
    if (!done) ok(await http.post('/v1/likes').set(a.auth).send({ targetId: b.id, action: 'like' }), 201, 409, 429);
  }
  for (const chat of CHATS) {
    const [x, y] = chat.pair.map((k) => ids.get(k)!);
    const [low, high] = x!.id < y!.id ? [x!.id, y!.id] : [y!.id, x!.id];
    const conv = await db.selectFrom('matches as m').innerJoin('conversations as c', 'c.match_id', 'm.id').select('c.id').where('m.user_low_id', '=', low).where('m.user_high_id', '=', high).executeTakeFirst();
    if (!conv) continue;
    for (const [i, [from, text]] of chat.messages.entries()) {
      ok(await http.post(`/v1/conversations/${conv.id}/messages`).set(ids.get(from)!.auth).send({ clientMessageId: `seed-demo-${conv.id.slice(0, 8)}-${i}`, kind: 'text', body: text }), 201);
    }
  }

  const discoverable = await db.selectFrom('user_profiles as p').innerJoin('users as u', 'u.id', 'p.user_id').select(sql<number>`count(*)::int`.as('n')).where('u.email', 'like', '%@demo.amora.dev').where('p.is_discoverable', '=', true).executeTakeFirstOrThrow();
  await app.close();

  console.log('\nDemo data ready.');
  console.log(`Admin console (http://localhost:3001) — password for all: ${DEMO_ADMIN_PASSWORD}`);
  for (const a of adminRows) console.log(`  ${a.role.padEnd(14)} ${a.email}`);
  console.log(`Mobile app — password for all: ${DEMO_MEMBER_PASSWORD}  (${discoverable.n}/${MEMBERS.length} discoverable)`);
  for (const m of MEMBERS) console.log(`  ${m.name.padEnd(6)} ${`${m.key}@demo.amora.dev`.padEnd(24)} ${m.gender}, ${m.age}, ${m.city}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
