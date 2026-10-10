import { createHmac } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { APP_CONFIG, type AppConfig } from '../../common/config/config';
import { AppError } from '../../common/errors/app-error';
import { sha256 } from '../../common/crypto/tokens';

export type SocialProvider = 'google' | 'apple' | 'facebook';

export interface SocialIdentity {
  provider: SocialProvider;
  subject: string;
  email: string | null;
  emailVerified: boolean;
}

const PROVIDERS = {
  google: { jwks: 'https://www.googleapis.com/oauth2/v3/certs', issuers: ['https://accounts.google.com', 'accounts.google.com'] },
  apple: { jwks: 'https://appleid.apple.com/auth/keys', issuers: ['https://appleid.apple.com'] },
  // iOS Limited Login returns an OIDC token instead of a Graph access token.
  facebook: { jwks: 'https://limited.facebook.com/.well-known/oauth/openid/jwks/', issuers: ['https://www.facebook.com', 'https://facebook.com'] },
} as const;

/**
 * Verifies identity tokens issued to our clients: OIDC ID tokens from Google, Apple and Facebook Limited Login
 * (signature, issuer, audience, expiry, nonce), and Facebook user access tokens via Graph debug_token.
 */
@Injectable()
export class SocialIdentityService {
  private readonly keySets = new Map<string, JWTVerifyGetKey>();

  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  /** Exposed for tests to inject a local key set. */
  setKeySet(provider: SocialProvider, keys: JWTVerifyGetKey): void {
    this.keySets.set(provider, keys);
  }

  async verify(provider: SocialProvider, idToken: string, nonce?: string): Promise<SocialIdentity> {
    if (provider === 'facebook' && idToken.split('.').length !== 3) return this.verifyFacebookAccessToken(idToken);
    const audience = provider === 'google' ? this.cfg.GOOGLE_CLIENT_IDS : provider === 'apple' ? this.cfg.APPLE_CLIENT_IDS : this.cfg.FACEBOOK_APP_ID ? [this.cfg.FACEBOOK_APP_ID] : [];
    if (audience.length === 0) throw new AppError('SOCIAL_PROVIDER_NOT_CONFIGURED', `${provider} sign-in is not configured`);

    let keys = this.keySets.get(provider);
    if (!keys) {
      keys = createRemoteJWKSet(new URL(PROVIDERS[provider].jwks));
      this.keySets.set(provider, keys);
    }

    let payload;
    try {
      ({ payload } = await jwtVerify(idToken, keys, { issuer: [...PROVIDERS[provider].issuers], audience }));
    } catch {
      throw new AppError('SOCIAL_TOKEN_INVALID');
    }
    if (nonce !== undefined) {
      // Apple hashes the nonce (SHA-256 hex); Google returns it verbatim.
      const expected = provider === 'apple' ? sha256(nonce).toString('hex') : nonce;
      if (payload.nonce !== expected) throw new AppError('SOCIAL_TOKEN_INVALID', 'nonce mismatch');
    }
    if (typeof payload.sub !== 'string') throw new AppError('SOCIAL_TOKEN_INVALID');
    const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : null;
    // Facebook does not assert email verification in a way we can rely on for account linking.
    const emailVerified = provider !== 'facebook' && (payload.email_verified === true || payload.email_verified === 'true');
    return { provider, subject: payload.sub, email, emailVerified };
  }

  /** Classic Facebook Login: the token must be valid, issued for our app, and the profile is read with appsecret_proof. */
  private async verifyFacebookAccessToken(token: string): Promise<SocialIdentity> {
    const { FACEBOOK_APP_ID: appId, FACEBOOK_APP_SECRET: secret, FACEBOOK_GRAPH_BASE: base } = this.cfg;
    if (!appId || !secret) throw new AppError('SOCIAL_PROVIDER_NOT_CONFIGURED', 'facebook sign-in is not configured');
    const get = async (path: string, params: Record<string, string>) => {
      const res = await fetch(`${base}${path}?${new URLSearchParams(params)}`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
      if (!res) throw new AppError('SOCIAL_PROVIDER_UNAVAILABLE', 'facebook is unreachable');
      if (!res.ok) throw new AppError('SOCIAL_TOKEN_INVALID');
      return (await res.json()) as Record<string, unknown>;
    };
    const debug = (await get('/debug_token', { input_token: token, access_token: `${appId}|${secret}` })).data as { is_valid?: boolean; app_id?: string; user_id?: string; expires_at?: number } | undefined;
    if (!debug?.is_valid || debug.app_id !== appId || !debug.user_id) throw new AppError('SOCIAL_TOKEN_INVALID');
    if (debug.expires_at && debug.expires_at * 1000 < Date.now()) throw new AppError('SOCIAL_TOKEN_INVALID');
    const me = await get('/me', { fields: 'id,email', access_token: token, appsecret_proof: createHmac('sha256', secret).update(token).digest('hex') });
    if (me.id !== debug.user_id) throw new AppError('SOCIAL_TOKEN_INVALID');
    return { provider: 'facebook', subject: debug.user_id, email: typeof me.email === 'string' ? me.email.toLowerCase() : null, emailVerified: false };
  }
}
