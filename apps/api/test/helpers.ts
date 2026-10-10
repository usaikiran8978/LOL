import 'reflect-metadata';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../src/bootstrap';
import { loadConfig } from '../src/common/config/config';
import { DATABASE, type Database } from '../src/common/db/database';
import { DevMessageSink } from '../src/common/messaging/messaging';
import { OutboxService } from '../src/common/outbox/outbox.service';
import { testEnv } from './env';

export interface TestApp {
  app: INestApplication;
  http: ReturnType<typeof request>;
  db: Database;
  sink: DevMessageSink;
  close(): Promise<void>;
}

export async function createTestApp(overrides: Record<string, string> = {}, opts: { listen?: boolean } = {}): Promise<TestApp & { port?: number }> {
  const app = await createApp(loadConfig(testEnv(overrides)));
  if (opts.listen) await app.listen(0);
  else await app.init();
  return {
    app,
    http: request(app.getHttpServer()),
    db: app.get<Database>(DATABASE),
    sink: app.get(DevMessageSink),
    close: () => app.close(),
    port: opts.listen ? (app.getHttpServer().address() as { port: number }).port : undefined,
  };
}

export function device(platform: 'ios' | 'android' = 'ios') {
  return { installationId: `inst-${randomUUID()}`, platform, model: 'Test', osVersion: '18', appVersion: '1.0.0' };
}

export function uniqueEmail(): string {
  return `user-${randomUUID().slice(0, 8)}@example.test`;
}

let phoneSeq = 0;
export function uniquePhone(): string {
  phoneSeq += 1;
  return `+1415${String(Date.now() % 1_000_000).padStart(6, '0').slice(0, 3)}${String(phoneSeq).padStart(4, '0')}`;
}

export function codeFrom(sink: DevMessageSink, to: string): string {
  const body = sink.lastTo(to);
  const code = body?.match(/\b(\d{6})\b/)?.[1];
  if (!code) throw new Error(`no code sent to ${to}`);
  return code;
}

export function yearsAgo(years: number, plusDays = 0): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  d.setUTCDate(d.getUTCDate() + plusDays);
  return d.toISOString().slice(0, 10);
}

export async function legalIds(http: TestApp['http']): Promise<{ terms: string; privacy: string }> {
  const terms = await http.get('/v1/legal/terms').expect(200);
  const privacy = await http.get('/v1/legal/privacy').expect(200);
  return { terms: terms.body.id, privacy: privacy.body.id };
}

export async function registerUser(t: TestApp, opts: { email?: string; phone?: string; password?: string } = {}) {
  const legal = await legalIds(t.http);
  const email = opts.phone && !opts.email ? undefined : (opts.email ?? uniqueEmail());
  const password = opts.password ?? 'correct horse battery';
  const res = await t.http
    .post('/v1/auth/register')
    .send({
      email,
      phone: opts.phone,
      password: email ? password : opts.password,
      dateOfBirth: yearsAgo(25),
      countryCode: 'US',
      locale: 'en',
      acceptedTermsVersionId: legal.terms,
      acceptedPrivacyVersionId: legal.privacy,
      confirmsMinimumAge: true,
      device: device(),
    })
    .expect(201);
  return { email, password, body: res.body };
}

// ------------------------------------------------------------------ admin helpers

export const ADMIN_TEST_PASSWORD = 'admin test passphrase 123';

export async function adminSession(t: TestApp, roleKey: string): Promise<{ id: string; cookie: string; csrf: string; as: (r: request.Test) => request.Test }> {
  const { Algorithm, hash } = await import('@node-rs/argon2');
  const email = `admin-${randomUUID().slice(0, 8)}@amora.test`;
  const admin = await t.db
    .insertInto('admin_users')
    .values({ email, display_name: roleKey, password_hash: await hash(ADMIN_TEST_PASSWORD, { algorithm: Algorithm.Argon2id }), status: 'active' })
    .returning('id')
    .executeTakeFirstOrThrow();
  const role = await t.db.selectFrom('admin_roles').select('id').where('key', '=', roleKey).executeTakeFirstOrThrow();
  await t.db.insertInto('admin_user_roles').values({ admin_user_id: admin.id, role_id: role.id }).execute();
  const res = await t.http.post('/v1/admin/auth/login').send({ email, password: ADMIN_TEST_PASSWORD }).expect(200);
  const cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('amora_admin='))!.split(';')[0]!;
  const csrf = res.body.csrfToken as string;
  return { id: admin.id, cookie, csrf, as: (r) => r.set('Cookie', cookie).set('X-CSRF-Token', csrf) };
}

export function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

/** Verified, active user with an access token. */
export async function activeUser(t: TestApp) {
  const reg = await registerUser(t);
  const auth = bearer(reg.body.tokens.accessToken);
  await t.http.post('/v1/auth/verification/confirm').set(auth).send({ channel: 'email', code: codeFrom(t.sink, reg.email!) }).expect(200);
  return { id: reg.body.user.id as string, email: reg.email!, password: reg.password, auth, token: reg.body.tokens.accessToken as string };
}

export async function termId(t: TestApp, kind: string, key: string): Promise<string> {
  const r = await t.db.selectFrom('taxonomy_terms').select('id').where('kind', '=', kind).where('key', '=', key).executeTakeFirstOrThrow();
  return r.id;
}

/** Answers every applicable required question with its first option / scale midpoint. */
export async function answerRequired(t: TestApp, auth: Record<string, string>) {
  const qs = (await t.http.get('/v1/questions').set(auth).expect(200)).body as Array<{ questionId: string; versionId: string; answerType: string; isRequired: boolean; options: Array<{ key: string }>; constraints: { scaleMin: number; scaleMax: number } }>;
  for (const q of qs.filter((x) => x.isRequired)) {
    const value =
      q.answerType === 'scale' ? { value: Math.round((q.constraints.scaleMin + q.constraints.scaleMax) / 2) }
      : q.answerType === 'multiple_choice' ? { optionKeys: [q.options[0]!.key] }
      : q.answerType === 'ranking' ? { rankedOptionKeys: q.options.map((o) => o.key) }
      : { optionKey: q.options[0]!.key };
    await t.http.post('/v1/answers').set(auth).send({ questionId: q.questionId, versionId: q.versionId, value }).expect(201);
  }
}

export interface DiscoverableOpts {
  gender: 'woman' | 'man';
  seeking: Array<'woman' | 'man'>;
  lat: number;
  lon: number;
  intent?: string;
  name?: string;
  age?: number;
  interestKeys?: string[];
  answers?: Record<string, unknown>; // question key → value (overrides defaults)
}

/** A verified user who completed onboarding, has approved photos and is discoverable. */
export async function discoverableUser(t: TestApp, o: DiscoverableOpts) {
  const u = await activeUser(t);
  if (o.age) {
    const d = new Date();
    d.setUTCFullYear(d.getUTCFullYear() - o.age);
    await t.db.updateTable('users').set({ date_of_birth: d.toISOString().slice(0, 10) }).where('id', '=', u.id).execute();
  }
  const city = await t.db.selectFrom('cities').select('id').orderBy(sql`abs(latitude - ${o.lat}) + abs(longitude - ${o.lon})`).limit(1).executeTakeFirstOrThrow();
  await t.http.put('/v1/profiles/me').set(u.auth).send({
    displayName: o.name ?? `U${u.id.slice(0, 4)}`, bio: 'I enjoy long walks, good coffee and honest conversations.', cityId: city.id,
    genderId: await termId(t, 'gender', o.gender), datingIntentId: await termId(t, 'dating_intent', o.intent ?? 'long_term'), relationshipGoalId: await termId(t, 'relationship_goal', 'committed'),
  }).expect(200);
  await t.http.post('/v1/users/me/consents').set(u.auth).send({ consentType: 'location', granted: true }).expect(200);
  await t.http.put('/v1/location').set(u.auth).send({ latitude: o.lat, longitude: o.lon, source: 'gps' }).expect(200);
  await t.http.put('/v1/preferences').set(u.auth).send({
    ageMin: 18, ageMax: 60, maxDistanceKm: 50,
    terms: { gender: await Promise.all(o.seeking.map(async (g) => ({ termId: await termId(t, 'gender', g), isDealbreaker: false }))) },
  }).expect(200);
  const keys = o.interestKeys ?? ['hiking', 'coffee', 'reading'];
  const interests = await t.db.selectFrom('interests').select('id').where('key', 'in', keys).execute();
  await t.http.put('/v1/profiles/me/interests').set(u.auth).send({ interestIds: interests.map((i) => i.id) }).expect(200);
  for (let i = 0; i < 2; i++) {
    await t.db.insertInto('profile_media').values({ user_id: u.id, kind: 'photo', storage_key: `test/${u.id}/${i}`, mime_type: 'image/jpeg', byte_size: 1000, position: i, processing_status: 'ready', moderation_status: 'approved' }).execute();
  }
  const qs = (await t.http.get('/v1/questions').set(u.auth).expect(200)).body as Array<{ key: string; questionId: string; versionId: string; answerType: string; isRequired: boolean; options: Array<{ key: string }>; constraints: { scaleMin: number; scaleMax: number } }>;
  for (const q of qs) {
    const override = o.answers?.[q.key];
    if (!q.isRequired && override === undefined) continue;
    const body: Record<string, unknown> = { questionId: q.questionId, versionId: q.versionId };
    if (override && typeof override === 'object' && 'body' in (override as object)) Object.assign(body, (override as { body: object }).body);
    else body.value = override ?? (q.answerType === 'scale' ? { value: Math.round((q.constraints.scaleMin + q.constraints.scaleMax) / 2) } : { optionKey: q.options[0]!.key });
    await t.http.post('/v1/answers').set(u.auth).send(body).expect(201);
  }
  await t.http.put('/v1/onboarding/step').set(u.auth).send({ step: 'questionnaire', complete: true }).expect(200);
  await t.http.post('/v1/onboarding/complete').set(u.auth).expect(200);
  await t.http.put('/v1/profiles/me').set(u.auth).send({}).expect(200);
  const p = await t.db.selectFrom('user_profiles').select('is_discoverable').where('user_id', '=', u.id).executeTakeFirstOrThrow();
  if (!p.is_discoverable) throw new Error('test user is not discoverable');
  return u;
}

export async function grant(t: TestApp, userId: string, ...keys: string[]) {
  await t.db.insertInto('entitlements').values(keys.map((entitlement_key) => ({ user_id: userId, entitlement_key, source_type: 'admin_grant' }))).execute();
}

/** Drains the outbox completely (suites share a database, so earlier suites may leave events behind). */
export async function drainOutbox(t: TestApp) {
  const outbox = t.app.get(OutboxService);
  while ((await outbox.processPending(500)) > 0) { /* keep draining */ }
}
