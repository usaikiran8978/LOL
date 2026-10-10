import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createTestApp, device, legalIds, registerUser, uniqueEmail, yearsAgo, type TestApp } from './helpers';

/**
 * Facebook Login against a local stand-in for the Graph API (test double only — production uses graph.facebook.com).
 * It reproduces the two calls we depend on: debug_token (app access token) and /me (with appsecret_proof).
 */
const APP_ID = '1234567890';
const SECRET = 'fb-app-secret-for-tests';
const users = new Map<string, { id: string; email?: string; appId?: string; valid?: boolean }>();

describe('Facebook login (e2e)', () => {
  let t: TestApp;
  let graph: Server;
  const calls: string[] = [];

  beforeAll(async () => {
    graph = createServer((req, res) => {
      const url = new URL(req.url!, 'http://x');
      calls.push(url.pathname);
      const send = (code: number, body: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
      if (url.pathname === '/debug_token') {
        if (url.searchParams.get('access_token') !== `${APP_ID}|${SECRET}`) return send(400, { error: { message: 'bad app token' } });
        const u = users.get(url.searchParams.get('input_token')!);
        return send(200, { data: u ? { is_valid: u.valid ?? true, app_id: u.appId ?? APP_ID, user_id: u.id } : { is_valid: false } });
      }
      if (url.pathname === '/me') {
        const token = url.searchParams.get('access_token')!;
        const proof = createHmac('sha256', SECRET).update(token).digest('hex');
        if (url.searchParams.get('appsecret_proof') !== proof) return send(400, { error: { message: 'bad proof' } });
        const u = users.get(token);
        return u ? send(200, { id: u.id, email: u.email }) : send(400, {});
      }
      send(404, {});
    });
    await new Promise<void>((r) => graph.listen(0, '127.0.0.1', r));
    t = await createTestApp({ FACEBOOK_APP_ID: APP_ID, FACEBOOK_APP_SECRET: SECRET, FACEBOOK_GRAPH_BASE: `http://127.0.0.1:${(graph.address() as AddressInfo).port}` });
  });
  afterAll(async () => {
    await t.close();
    await new Promise((r) => graph.close(r));
  });

  it('creates an account from a valid access token without trusting the Facebook email for linking', async () => {
    const email = uniqueEmail();
    users.set('fb-token-alice-000000000000', { id: 'fb-alice', email });
    const legal = await legalIds(t.http);
    const res = await t.http.post('/v1/auth/social').send({
      provider: 'facebook', idToken: 'fb-token-alice-000000000000', device: device(),
      signup: { dateOfBirth: yearsAgo(30), countryCode: 'US', locale: 'en', acceptedTermsVersionId: legal.terms, acceptedPrivacyVersionId: legal.privacy, confirmsMinimumAge: true },
    });
    if (res.status !== 200) throw new Error(JSON.stringify(res.body));
    expect(res.body).toMatchObject({ isNewUser: true, user: { email: null } });
    expect(calls).toEqual(expect.arrayContaining(['/debug_token', '/me']));
    const again = await t.http.post('/v1/auth/social').send({ provider: 'facebook', idToken: 'fb-token-alice-000000000000', device: device() }).expect(200);
    expect(again.body.user.id).toBe(res.body.user.id);
  });

  it('never auto-links to an existing account by email', async () => {
    const { email } = await registerUser(t);
    users.set('fb-token-bob-00000000000000', { id: 'fb-bob', email });
    const r = await t.http.post('/v1/auth/social').send({ provider: 'facebook', idToken: 'fb-token-bob-00000000000000', device: device() }).expect(409);
    expect(r.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('rejects tokens that are invalid or were issued to another app', async () => {
    users.set('fb-token-other-app-000000000', { id: 'fb-carol', appId: '999' });
    users.set('fb-token-revoked-00000000000', { id: 'fb-dave', valid: false });
    for (const idToken of ['fb-token-other-app-000000000', 'fb-token-revoked-00000000000', 'fb-token-unknown-00000000000']) {
      const r = await t.http.post('/v1/auth/social').send({ provider: 'facebook', idToken, device: device() }).expect(401);
      expect(r.body.error.code).toBe('SOCIAL_TOKEN_INVALID');
    }
  });

  it('reports the provider as not configured when the app credentials are missing', async () => {
    const plain = await createTestApp();
    try {
      const r = await plain.http.post('/v1/auth/social').send({ provider: 'facebook', idToken: 'fb-token-alice-000000000000', device: device() }).expect(503);
      expect(r.body.error.code).toBe('SOCIAL_PROVIDER_NOT_CONFIGURED');
    } finally {
      await plain.close();
    }
  });
});
