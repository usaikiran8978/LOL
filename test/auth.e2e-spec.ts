import { exportJWK, generateKeyPair, SignJWT, createLocalJWKSet } from 'jose';
import { SocialIdentityService } from '../src/modules/auth/social.service';
import { codeFrom, createTestApp, device, legalIds, registerUser, uniqueEmail, uniquePhone, yearsAgo, type TestApp } from './helpers';

describe('Auth (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ GOOGLE_CLIENT_IDS: 'test-google-client' });
  });
  afterAll(() => t.close());

  describe('registration', () => {
    it('rejects users under the country minimum age without creating an account', async () => {
      const legal = await legalIds(t.http);
      const email = uniqueEmail();
      const res = await t.http
        .post('/v1/auth/register')
        .send({
          email, password: 'correct horse battery', dateOfBirth: yearsAgo(18, 1), countryCode: 'US', locale: 'en',
          acceptedTermsVersionId: legal.terms, acceptedPrivacyVersionId: legal.privacy, confirmsMinimumAge: true, device: device(),
        })
        .expect(403);
      expect(res.body.error.code).toBe('AGE_INELIGIBLE');
      expect(await t.db.selectFrom('users').select('id').where('email', '=', email).executeTakeFirst()).toBeUndefined();
    });

    it('requires the current terms and privacy policy to be accepted', async () => {
      const legal = await legalIds(t.http);
      const res = await t.http
        .post('/v1/auth/register')
        .send({
          email: uniqueEmail(), password: 'correct horse battery', dateOfBirth: yearsAgo(30), countryCode: 'US', locale: 'en',
          acceptedTermsVersionId: legal.privacy, acceptedPrivacyVersionId: legal.terms, confirmsMinimumAge: true, device: device(),
        })
        .expect(400);
      expect(res.body.error.code).toBe('CONSENT_REQUIRED');
    });

    it('rejects unsupported countries', async () => {
      const legal = await legalIds(t.http);
      const res = await t.http
        .post('/v1/auth/register')
        .send({
          email: uniqueEmail(), password: 'correct horse battery', dateOfBirth: yearsAgo(30), countryCode: 'ZZ', locale: 'en',
          acceptedTermsVersionId: legal.terms, acceptedPrivacyVersionId: legal.privacy, confirmsMinimumAge: true, device: device(),
        })
        .expect(400);
      expect(res.body.error.code).toBe('COUNTRY_NOT_SUPPORTED');
    });

    it('returns structured validation errors', async () => {
      const res = await t.http.post('/v1/auth/register').send({ email: 'not-an-email' }).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(Array.isArray(res.body.error.details)).toBe(true);
      expect(res.body.error.requestId).toEqual(expect.any(String));
    });

    it('creates a pending account, records consents, issues tokens and sends a verification code', async () => {
      const { email, body } = await registerUser(t);
      expect(body.isNewUser).toBe(true);
      expect(body.user).toMatchObject({ email, emailVerified: false, status: 'pending', onboardingCompleted: false });
      expect(body.tokens.accessToken).toEqual(expect.any(String));
      expect(codeFrom(t.sink, email!)).toMatch(/^\d{6}$/);

      const consents = await t.http.get('/v1/users/me/consents').set('Authorization', `Bearer ${body.tokens.accessToken}`).expect(200);
      const types = consents.body.map((c: { consentType: string }) => c.consentType).sort();
      expect(types).toEqual(['age_confirmation', 'marketing_email', 'privacy', 'terms']);

      const audit = await t.db.selectFrom('audit_logs').select('action').where('actor_id', '=', body.user.id).execute();
      expect(audit.map((a) => a.action)).toContain('auth.register');
      const events = await t.db.selectFrom('analytics_events').select('name').where('user_id', '=', body.user.id).execute();
      expect(events.map((e) => e.name)).toContain('signup_completed');
    });

    it('rejects a duplicate email', async () => {
      const { email } = await registerUser(t);
      const legal = await legalIds(t.http);
      const res = await t.http
        .post('/v1/auth/register')
        .send({
          email: email!.toUpperCase(), password: 'correct horse battery', dateOfBirth: yearsAgo(30), countryCode: 'US', locale: 'en',
          acceptedTermsVersionId: legal.terms, acceptedPrivacyVersionId: legal.privacy, confirmsMinimumAge: true, device: device(),
        })
        .expect(409);
      expect(res.body.error.code).toBe('EMAIL_TAKEN');
    });
  });

  describe('contact verification', () => {
    it('rejects a wrong code then verifies with the right one and activates the account', async () => {
      const { email, body } = await registerUser(t);
      const auth = { Authorization: `Bearer ${body.tokens.accessToken}` };
      const code = codeFrom(t.sink, email!);
      const wrong = code === '000000' ? '111111' : '000000';

      const bad = await t.http.post('/v1/auth/verification/confirm').set(auth).send({ channel: 'email', code: wrong }).expect(400);
      expect(bad.body.error.code).toBe('OTP_INVALID');

      const ok = await t.http.post('/v1/auth/verification/confirm').set(auth).send({ channel: 'email', code }).expect(200);
      expect(ok.body).toMatchObject({ emailVerified: true, status: 'active' });

      const reuse = await t.http.post('/v1/auth/verification/confirm').set(auth).send({ channel: 'email', code }).expect(400);
      expect(reuse.body.error.code).toBe('OTP_INVALID');
    });

    it('locks a code after too many wrong attempts', async () => {
      const { email, body } = await registerUser(t);
      const auth = { Authorization: `Bearer ${body.tokens.accessToken}` };
      const code = codeFrom(t.sink, email!);
      const wrong = code === '000000' ? '111111' : '000000';
      for (let i = 0; i < 4; i++) await t.http.post('/v1/auth/verification/confirm').set(auth).send({ channel: 'email', code: wrong }).expect(400);
      const fifth = await t.http.post('/v1/auth/verification/confirm').set(auth).send({ channel: 'email', code: wrong });
      expect(fifth.body.error.code).toBe('OTP_TOO_MANY_ATTEMPTS');
      const after = await t.http.post('/v1/auth/verification/confirm').set(auth).send({ channel: 'email', code });
      expect(after.body.error.code).toBe('OTP_INVALID');
    });
  });

  describe('login, lockout, sessions', () => {
    it('logs in with password and lists the session', async () => {
      const { email, password } = await registerUser(t);
      const res = await t.http.post('/v1/auth/login').send({ identifier: email, password, device: device('android') }).expect(200);
      const sessions = await t.http.get('/v1/users/me/sessions').set('Authorization', `Bearer ${res.body.tokens.accessToken}`).expect(200);
      expect(sessions.body).toHaveLength(2);
      expect(sessions.body.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
    });

    it('does not reveal whether an account exists', async () => {
      const unknown = await t.http.post('/v1/auth/login').send({ identifier: uniqueEmail(), password: 'whatever-password', device: device() }).expect(401);
      const { email } = await registerUser(t);
      const wrong = await t.http.post('/v1/auth/login').send({ identifier: email, password: 'wrong-password-x', device: device() }).expect(401);
      expect(unknown.body.error.code).toBe('INVALID_CREDENTIALS');
      expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('locks the account after repeated failures, even for the correct password', async () => {
      const { email, password } = await registerUser(t);
      for (let i = 0; i < 5; i++) await t.http.post('/v1/auth/login').send({ identifier: email, password: 'wrong-password-x', device: device() }).expect(401);
      const locked = await t.http.post('/v1/auth/login').send({ identifier: email, password, device: device() }).expect(423);
      expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');
      expect(locked.body.error.details.retryAfterSeconds).toBeGreaterThan(0);
    });

    it('rotates refresh tokens and revokes the session when an old refresh token is replayed', async () => {
      const { body } = await registerUser(t);
      const first = body.tokens.refreshToken;
      const rotated = await t.http.post('/v1/auth/refresh').send({ refreshToken: first }).expect(200);
      expect(rotated.body.refreshToken).not.toBe(first);

      const replay = await t.http.post('/v1/auth/refresh').send({ refreshToken: first }).expect(401);
      expect(replay.body.error.code).toBe('REFRESH_TOKEN_REUSED');

      // The legitimately rotated token is now dead too, and so is the access token.
      await t.http.post('/v1/auth/refresh').send({ refreshToken: rotated.body.refreshToken }).expect(401);
      await t.http.get('/v1/users/me').set('Authorization', `Bearer ${rotated.body.accessToken}`).expect(401);
    });

    it('logout invalidates the access token immediately', async () => {
      const { body } = await registerUser(t);
      const auth = { Authorization: `Bearer ${body.tokens.accessToken}` };
      await t.http.get('/v1/users/me').set(auth).expect(200);
      await t.http.post('/v1/auth/logout').set(auth).expect(204);
      const after = await t.http.get('/v1/users/me').set(auth).expect(401);
      expect(after.body.error.code).toBe('TOKEN_INVALID');
    });

    it('lets a user revoke another of their sessions but not someone else\'s', async () => {
      const a = await registerUser(t);
      const second = await t.http.post('/v1/auth/login').send({ identifier: a.email, password: a.password, device: device() }).expect(200);
      const b = await registerUser(t);
      await t.http.delete(`/v1/users/me/sessions/${second.body.tokens.sessionId}`).set('Authorization', `Bearer ${b.body.tokens.accessToken}`).expect(404);
      await t.http.delete(`/v1/users/me/sessions/${second.body.tokens.sessionId}`).set('Authorization', `Bearer ${a.body.tokens.accessToken}`).expect(204);
      await t.http.get('/v1/users/me').set('Authorization', `Bearer ${second.body.tokens.accessToken}`).expect(401);
    });

    it('blocks banned users from logging in and from using existing tokens', async () => {
      const { email, password, body } = await registerUser(t);
      await t.db.updateTable('users').set({ status: 'banned' }).where('id', '=', body.user.id).execute();
      const login = await t.http.post('/v1/auth/login').send({ identifier: email, password, device: device() }).expect(403);
      expect(login.body.error.code).toBe('ACCOUNT_BANNED');
      await t.http.get('/v1/users/me').set('Authorization', `Bearer ${body.tokens.accessToken}`).expect(403);
    });

    it('changes the password, keeps the current session and signs out other devices', async () => {
      const { email, password, body } = await registerUser(t);
      const other = await t.http.post('/v1/auth/login').send({ identifier: email, password, device: device('android') }).expect(200);
      const auth = { Authorization: `Bearer ${body.tokens.accessToken}` };

      const wrong = await t.http.post('/v1/auth/password/change').set(auth).send({ currentPassword: 'not-my-password', newPassword: 'another long passphrase' }).expect(401);
      expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');

      await t.http.post('/v1/auth/password/change').set(auth).send({ currentPassword: password, newPassword: 'another long passphrase' }).expect(204);
      await t.http.get('/v1/users/me').set(auth).expect(200);
      await t.http.get('/v1/users/me').set('Authorization', `Bearer ${other.body.tokens.accessToken}`).expect(401);
      await t.http.post('/v1/auth/login').send({ identifier: email, password: 'another long passphrase', device: device() }).expect(200);
    });

    it('rejects tampered access tokens', async () => {
      const { body } = await registerUser(t);
      const [h, p, s] = body.tokens.accessToken.split('.');
      const tampered = `${h}.${p}.${s!.slice(0, -2)}xx`;
      await t.http.get('/v1/users/me').set('Authorization', `Bearer ${tampered}`).expect(401);
    });
  });

  describe('password reset & recovery', () => {
    it('accepts reset requests for unknown accounts without sending anything', async () => {
      const email = uniqueEmail();
      await t.http.post('/v1/auth/otp/request').send({ channel: 'email', destination: email, purpose: 'password_reset' }).expect(202);
      expect(t.sink.lastTo(email)).toBeUndefined();
    });

    it('resets the password and revokes existing sessions', async () => {
      const { email, password, body } = await registerUser(t);
      await t.http.post('/v1/auth/otp/request').send({ channel: 'email', destination: email, purpose: 'password_reset' }).expect(202);
      const code = codeFrom(t.sink, email!);
      await t.http.post('/v1/auth/password/reset').send({ channel: 'email', destination: email, code, newPassword: 'a brand new passphrase' }).expect(204);

      await t.http.get('/v1/users/me').set('Authorization', `Bearer ${body.tokens.accessToken}`).expect(401);
      await t.http.post('/v1/auth/login').send({ identifier: email, password, device: device() }).expect(401);
      await t.http.post('/v1/auth/login').send({ identifier: email, password: 'a brand new passphrase', device: device() }).expect(200);
    });

    it('recovers an account through a verified contact and signs out every other device', async () => {
      const { email, body } = await registerUser(t);
      const auth = { Authorization: `Bearer ${body.tokens.accessToken}` };
      await t.http.post('/v1/auth/verification/confirm').set(auth).send({ channel: 'email', code: codeFrom(t.sink, email!) }).expect(200);

      await t.http.post('/v1/auth/otp/request').send({ channel: 'email', destination: email, purpose: 'account_recovery' }).expect(202);
      const res = await t.http
        .post('/v1/auth/recovery')
        .send({ channel: 'email', destination: email, code: codeFrom(t.sink, email!), newPassword: 'recovered passphrase', device: device() })
        .expect(200);
      expect(res.body.tokens.accessToken).toEqual(expect.any(String));
      await t.http.get('/v1/users/me').set(auth).expect(401);
    });
  });

  describe('phone OTP login', () => {
    it('signs up with phone only and logs in with an SMS code', async () => {
      const phone = uniquePhone();
      await registerUser(t, { phone });
      expect(codeFrom(t.sink, phone)).toMatch(/^\d{6}$/); // verify_phone code sent at sign-up

      await t.http.post('/v1/auth/otp/request').send({ channel: 'sms', destination: phone, purpose: 'login_otp' }).expect(202);
      const res = await t.http.post('/v1/auth/otp/login').send({ phone, code: codeFrom(t.sink, phone), device: device() }).expect(200);
      expect(res.body.user).toMatchObject({ phone, phoneVerified: true, status: 'active' });
    });
  });

  describe('social login', () => {
    let privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];

    beforeAll(async () => {
      const pair = await generateKeyPair('RS256');
      privateKey = pair.privateKey;
      const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256' };
      t.app.get(SocialIdentityService).setKeySet('google', createLocalJWKSet({ keys: [jwk] }));
    });

    const googleToken = (sub: string, email: string, audience = 'test-google-client') =>
      new SignJWT({ email, email_verified: true })
        .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setIssuer('https://accounts.google.com')
        .setAudience(audience)
        .setSubject(sub)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(privateKey);

    it('asks for sign-up details for a new identity, then creates a verified account', async () => {
      const email = uniqueEmail();
      const idToken = await googleToken(`g-${email}`, email);
      const first = await t.http.post('/v1/auth/social').send({ provider: 'google', idToken, device: device() }).expect(400);
      expect(first.body.error).toMatchObject({ code: 'CONSENT_REQUIRED', details: { needsSignup: true } });

      const legal = await legalIds(t.http);
      const res = await t.http
        .post('/v1/auth/social')
        .send({
          provider: 'google', idToken, device: device(),
          signup: { dateOfBirth: yearsAgo(29), countryCode: 'IN', locale: 'en', acceptedTermsVersionId: legal.terms, acceptedPrivacyVersionId: legal.privacy, confirmsMinimumAge: true },
        })
        .expect(200);
      expect(res.body).toMatchObject({ isNewUser: true, user: { email, emailVerified: true, status: 'active' } });

      const again = await t.http.post('/v1/auth/social').send({ provider: 'google', idToken, device: device() }).expect(200);
      expect(again.body).toMatchObject({ isNewUser: false, user: { id: res.body.user.id } });
    });

    it('refuses to auto-link to an account whose email was never verified', async () => {
      const { email } = await registerUser(t);
      const idToken = await googleToken(`g-${email}`, email!);
      const res = await t.http.post('/v1/auth/social').send({ provider: 'google', idToken, device: device() }).expect(409);
      expect(res.body.error.code).toBe('EMAIL_TAKEN');
    });

    it('rejects tokens minted for another audience', async () => {
      const idToken = await googleToken('g-x', uniqueEmail(), 'someone-elses-client');
      const res = await t.http.post('/v1/auth/social').send({ provider: 'google', idToken, device: device() }).expect(401);
      expect(res.body.error.code).toBe('SOCIAL_TOKEN_INVALID');
    });

    it('reports an unconfigured provider instead of failing silently', async () => {
      const res = await t.http.post('/v1/auth/social').send({ provider: 'apple', idToken: 'x'.repeat(40), device: device() }).expect(503);
      expect(res.body.error.code).toBe('SOCIAL_PROVIDER_NOT_CONFIGURED');
    });
  });
});

describe('Rate limiting (e2e)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ RATE_LIMIT_ENABLED: 'true' });
  });
  afterAll(() => t.close());

  it('throttles repeated login attempts from one client', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await t.http.post('/v1/auth/login').send({ identifier: uniqueEmail(), password: 'whatever-password', device: device() });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });
});
