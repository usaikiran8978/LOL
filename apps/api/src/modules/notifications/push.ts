import { connect, type ClientHttp2Session } from 'node:http2';
import { importPKCS8, SignJWT } from 'jose';

export interface PushMessage {
  token: string;
  title: string | null;
  body: string;
  deepLink: string | null;
  category: string;
  collapseKey?: string | null;
  data?: Record<string, string>;
}

export type PushResult = { ok: true; providerMessageId: string | null } | { ok: false; retryable: boolean; invalidToken: boolean; error: string };

export interface PushProvider {
  readonly name: 'fcm' | 'apns';
  send(msg: PushMessage): Promise<PushResult>;
}

/** Firebase Cloud Messaging HTTP v1 (Android + iOS via FCM). Auth: service-account JWT → OAuth access token. */
export class FcmProvider implements PushProvider {
  readonly name = 'fcm' as const;
  private token: { value: string; exp: number } | null = null;

  constructor(private readonly sa: { project_id: string; client_email: string; private_key: string }) {}

  private async accessToken(): Promise<string> {
    if (this.token && this.token.exp > Date.now() + 60_000) return this.token.value;
    const key = await importPKCS8(this.sa.private_key, 'RS256');
    const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/firebase.messaging' })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' }).setIssuer(this.sa.client_email).setAudience('https://oauth2.googleapis.com/token')
      .setIssuedAt().setExpirationTime('1h').sign(key);
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    });
    if (!res.ok) throw new Error(`FCM auth failed: ${res.status}`);
    const j = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 };
    return j.access_token;
  }

  async send(msg: PushMessage): Promise<PushResult> {
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${this.sa.project_id}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await this.accessToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          token: msg.token,
          notification: { title: msg.title ?? undefined, body: msg.body },
          data: { ...(msg.data ?? {}), category: msg.category, ...(msg.deepLink ? { deepLink: msg.deepLink } : {}) },
          android: { collapse_key: msg.collapseKey ?? undefined, priority: 'HIGH' },
        },
      }),
    });
    if (res.ok) return { ok: true, providerMessageId: ((await res.json()) as { name?: string }).name ?? null };
    const text = await res.text();
    const invalid = res.status === 404 || /UNREGISTERED|INVALID_ARGUMENT/.test(text);
    return { ok: false, retryable: res.status === 429 || res.status >= 500, invalidToken: invalid, error: `FCM ${res.status}: ${text.slice(0, 300)}` };
  }
}

/** Apple Push Notification service, token-based auth (ES256 .p8 key) over HTTP/2. */
export class ApnsProvider implements PushProvider {
  readonly name = 'apns' as const;
  private jwt: { value: string; iat: number } | null = null;
  private session: ClientHttp2Session | null = null;

  constructor(private readonly opts: { keyP8: string; keyId: string; teamId: string; bundleId: string; production: boolean }) {}

  private async bearer(): Promise<string> {
    // Apple requires refreshing the provider token between 20 and 60 minutes.
    if (this.jwt && Date.now() - this.jwt.iat < 40 * 60_000) return this.jwt.value;
    const key = await importPKCS8(this.opts.keyP8, 'ES256');
    const value = await new SignJWT({}).setProtectedHeader({ alg: 'ES256', kid: this.opts.keyId }).setIssuer(this.opts.teamId).setIssuedAt().sign(key);
    this.jwt = { value, iat: Date.now() };
    return value;
  }

  private client(): ClientHttp2Session {
    if (!this.session || this.session.closed || this.session.destroyed) {
      this.session = connect(this.opts.production ? 'https://api.push.apple.com' : 'https://api.sandbox.push.apple.com');
      this.session.on('error', () => (this.session = null));
    }
    return this.session;
  }

  async send(msg: PushMessage): Promise<PushResult> {
    const auth = await this.bearer();
    const body = JSON.stringify({ aps: { alert: { title: msg.title ?? undefined, body: msg.body }, sound: 'default', 'thread-id': msg.category }, deepLink: msg.deepLink, ...(msg.data ?? {}) });
    return new Promise<PushResult>((resolve) => {
      const req = this.client().request({
        ':method': 'POST', ':path': `/3/device/${msg.token}`, authorization: `bearer ${auth}`, 'apns-topic': this.opts.bundleId,
        'apns-push-type': 'alert', ...(msg.collapseKey ? { 'apns-collapse-id': msg.collapseKey.slice(0, 64) } : {}),
      });
      let status = 0;
      let data = '';
      req.on('response', (h) => (status = Number(h[':status'])));
      req.on('data', (c: Buffer) => (data += c.toString()));
      req.on('end', () => {
        if (status === 200) return resolve({ ok: true, providerMessageId: null });
        resolve({ ok: false, retryable: status === 429 || status >= 500, invalidToken: status === 410 || /BadDeviceToken|Unregistered/.test(data), error: `APNs ${status}: ${data.slice(0, 300)}` });
      });
      req.on('error', (e) => resolve({ ok: false, retryable: true, invalidToken: false, error: e.message }));
      req.end(body);
    });
  }
}
