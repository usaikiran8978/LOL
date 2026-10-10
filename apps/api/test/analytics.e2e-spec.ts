import { sql } from 'kysely';
import { MetricsService } from '../src/modules/analytics/metrics.service';
import { AdaptiveService } from '../src/modules/matching/adaptive.service';
import { adminSession, createTestApp, discoverableUser, type TestApp } from './helpers';

describe('Analytics, experiments & adaptive matching (e2e)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('computes every BRD KPI for a day and serves the dashboard, series and CSV export', async () => {
    await discoverableUser(t, { gender: 'woman', seeking: ['man'], lat: 59.3293, lon: 18.0686 }); // suite may run on a fresh DB
    const today = new Date().toISOString().slice(0, 10);
    await t.app.get(MetricsService).compute(today);
    const sa = await adminSession(t, 'super_admin');
    const dash = (await sa.as(t.http.get('/v1/admin/analytics/dashboard?days=7')).expect(200)).body;
    expect(dash.live.total_users).toBeGreaterThan(0);
    for (const k of ['registrations', 'dau', 'likes', 'matches', 'match_rate', 'retention_d1', 'premium_conversion', 'report_rate', 'moderation_sla', 'ai_recommendation_acceptance']) {
      expect(dash.definitions[k]).toBeDefined();
    }
    expect(dash.series.registrations.find((p: { date: string; dimension: string }) => p.date === today && p.dimension === 'all').value).toBeGreaterThan(0);
    const countries = dash.series.registrations.length; // 'all' rows only on dashboard
    expect(countries).toBeGreaterThan(0);
    const series = (await sa.as(t.http.get(`/v1/admin/analytics/metrics/registrations?from=${today}&to=${today}&dimension=country:US`)).expect(200)).body;
    expect(Number(series[0].value)).toBeGreaterThan(0);
    await sa.as(t.http.get('/v1/admin/analytics/metrics/not_a_metric?from=2026-01-01&to=2026-01-02')).expect(404);
    const csv = await sa.as(t.http.get(`/v1/admin/analytics/export.csv?from=${today}&to=${today}`)).expect(200);
    expect(csv.text.split('\n')[0]).toBe('date,metric,dimension,value');
    const analyst = await adminSession(t, 'analyst');
    await analyst.as(t.http.get('/v1/admin/analytics/dashboard')).expect(200);
    await analyst.as(t.http.put('/v1/admin/analytics/experiments/x_test')).send({}).expect(403);
  });

  it('creates monthly analytics partitions and moves existing rows into them', async () => {
    await t.app.get(MetricsService).ensurePartitions();
    const d = new Date();
    const name = `analytics_events_${d.getUTCFullYear()}_${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const r = await sql<{ n: number }>`SELECT count(*)::int AS n FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid WHERE c.relname = ${name}`.execute(t.db);
    expect(r.rows[0]!.n).toBe(1);
    const inDefault = await sql<{ n: number }>`SELECT count(*)::int AS n FROM analytics_events_default WHERE occurred_at >= date_trunc('month', now())`.execute(t.db);
    expect(inDefault.rows[0]!.n).toBe(0);
  });

  it('runs an experiment: validates, assigns deterministically through /v1/config, logs exposure and reports results', async () => {
    const sa = await adminSession(t, 'super_admin');
    await sa.as(t.http.put('/v1/admin/analytics/experiments/paywall_copy')).send({ surface: 'paywall', trafficPct: 100, primaryMetric: 'paywall_viewed', variants: [{ key: 'a', allocation: 60, isControl: true }, { key: 'b', allocation: 30 }] }).expect(400);
    await sa.as(t.http.put('/v1/admin/analytics/experiments/paywall_copy')).send({
      surface: 'paywall', trafficPct: 100, primaryMetric: 'paywall_viewed', hypothesis: 'Benefit-led copy converts better',
      variants: [{ key: 'control', allocation: 50, isControl: true, config: { headline: 'Go Premium' } }, { key: 'benefits', allocation: 50, config: { headline: 'See who likes you' } }],
    }).expect(200);
    await sa.as(t.http.post('/v1/admin/analytics/experiments/paywall_copy/running')).send({}).expect(204);

    const users = [];
    for (let i = 0; i < 6; i++) users.push(await discoverableUser(t, { gender: i % 2 ? 'man' : 'woman', seeking: [i % 2 ? 'woman' : 'man'], lat: 59.3293, lon: 18.0686 }));
    const variants = new Set<string>();
    for (const u of users) {
      const c1 = (await t.http.get('/v1/config').set(u.auth).expect(200)).body.experiments.paywall_copy;
      const c2 = (await t.http.get('/v1/config').set(u.auth).expect(200)).body.experiments.paywall_copy;
      expect(c2).toEqual(c1); // stable
      variants.add(c1.variant);
      await t.http.post('/v1/analytics/events').set(u.auth).send({ platform: 'ios', events: [{ name: 'paywall_viewed', occurredAt: new Date().toISOString(), properties: {} }] }).expect(202);
    }
    const exposures = await t.db.selectFrom('analytics_events').select('user_id').where('name', '=', 'experiment_exposure').where('user_id', 'in', users.map((u) => u.id)).execute();
    expect(exposures).toHaveLength(6); // once per user
    const results = (await sa.as(t.http.get('/v1/admin/analytics/experiments/paywall_copy/results')).expect(200)).body;
    expect(results.variants.reduce((s: number, v: { assigned: number }) => s + v.assigned, 0)).toBe(6);
    expect(results.variants.every((v: { converted: number; assigned: number }) => v.converted === v.assigned)).toBe(true);
    await sa.as(t.http.put('/v1/admin/analytics/experiments/paywall_copy')).send({ surface: 'paywall', trafficPct: 50, primaryMetric: 'paywall_viewed', variants: [{ key: 'control', allocation: 100, isControl: true }, { key: 'x', allocation: 0 }] }).expect(400);
    await sa.as(t.http.post('/v1/admin/analytics/experiments/paywall_copy/completed')).send({}).expect(204);
    await sa.as(t.http.post('/v1/admin/analytics/experiments/paywall_copy/running')).send({}).expect(409);
    expect(variants.size).toBeGreaterThanOrEqual(1);
  });

  it('learns per-user affinities from outcomes for adaptive ranking', async () => {
    const seeker = await discoverableUser(t, { gender: 'woman', seeking: ['man'], lat: 59.3293, lon: 18.0686 });
    const cfg = await t.db.selectFrom('matching_config_versions').select('id').where('status', '=', 'published').executeTakeFirstOrThrow();
    const others = [];
    for (let i = 0; i < 30; i++) others.push(await t.db.insertInto('users').values({ email: `aff-${seeker.id.slice(0, 6)}-${i}@x.test`, status: 'active', date_of_birth: '1995-01-01', country_code: 'US' }).returning('id').executeTakeFirstOrThrow());
    for (const [i, o] of others.entries()) {
      const liked = i < 15;
      const mc = await t.db.insertInto('match_candidates').values({
        user_id: seeker.id, candidate_id: o.id, config_version_id: cfg.id, surface: 'swipe', compatibility: 70, confidence: 1, final_score: 0.7,
        factor_scores: JSON.stringify({ values: liked ? 92 : 35, lifestyle: 60 }), top_factors: '[]', rank: i, batch_id: cfg.id, expires_at: new Date(Date.now() + 86_400_000),
      }).returning('id').executeTakeFirstOrThrow();
      await t.db.insertInto('swipe_actions').values({ actor_id: seeker.id, target_id: o.id, action: liked ? 'like' : 'pass', surface: 'swipe', candidate_id: mc.id }).execute();
    }
    const svc = t.app.get(AdaptiveService);
    expect(await svc.learn(seeker.id)).toBe(true);
    const aff = await svc.affinities(seeker.id);
    expect(aff.values).toBeGreaterThan(1.5);
    expect(aff.lifestyle).toBe(1);
  });

  it('falls back to interest-fit event recommendations when AI is not configured', async () => {
    const u = await discoverableUser(t, { gender: 'woman', seeking: ['man'], lat: 51.5072, lon: -0.1276 });
    const res = (await t.http.get('/v1/events/recommended').set(u.auth).expect(200)).body;
    expect(res.source).toBe('interest_fit');
  });
});
