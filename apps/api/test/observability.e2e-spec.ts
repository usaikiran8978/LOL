import { createTestApp, type TestApp } from './helpers';

describe('Observability (e2e)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ METRICS_TOKEN: 'metrics-token-0123456789' });
  });
  afterAll(() => t.close());

  it('reports readiness of database and redis', async () => {
    const r = (await t.http.get('/health/ready').expect(200)).body;
    expect(r.checks).toEqual({ database: 'ok', redis: 'disabled' });
  });

  it('serves Prometheus metrics behind the token, labelled by route template', async () => {
    await t.http.get('/v1/legal/documents/terms').set('Accept-Language', 'en');
    await t.http.get('/metrics').expect(401);
    await t.http.get('/metrics').set('Authorization', 'Bearer wrong-token-0123456789').expect(401);
    const res = await t.http.get('/metrics').set('Authorization', 'Bearer metrics-token-0123456789').expect(200);
    expect(res.text).toContain('http_request_duration_seconds_bucket');
    expect(res.text).toContain('outbox_pending_events{state="pending"}');
    expect(res.text).toContain('process_cpu_user_seconds_total');
    expect(res.text).not.toMatch(/route="\/v1\/legal\/documents\/terms"/); // template, not raw path
  });
});
