import WebSocket from 'ws';
import { RealtimeBus } from '../src/common/realtime/realtime-bus';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { OBJECT_STORAGE, type InMemoryObjectStorage } from '../src/common/storage/object-storage';
import { adminSession, createTestApp, discoverableUser, drainOutbox, type TestApp } from './helpers';

const HERE = { lat: 53.4808, lon: -2.2426 }; // Manchester — isolated from other suites

describe('Chat, realtime & notifications (e2e)', () => {
  let t: TestApp & { port?: number };

  beforeAll(async () => {
    t = await createTestApp({}, { listen: true });
  });
  afterAll(() => t.close());

  async function matchedPair() {
    const a = await discoverableUser(t, { gender: 'woman', seeking: ['man'], ...HERE });
    const b = await discoverableUser(t, { gender: 'man', seeking: ['woman'], ...HERE });
    await t.http.post('/v1/likes').set(a.auth).send({ targetId: b.id, action: 'like' }).expect(201);
    const m = await t.http.post('/v1/likes').set(b.auth).send({ targetId: a.id, action: 'like' }).expect(201);
    return { a, b, matchId: m.body.matchId as string, conversationId: m.body.conversationId as string };
  }

  const send = (auth: Record<string, string>, conv: string, body: string, extra: Record<string, unknown> = {}) =>
    t.http.post(`/v1/conversations/${conv}/messages`).set(auth).send({ clientMessageId: `c-${Math.random().toString(36).slice(2)}`, kind: 'text', body, ...extra });

  function connect(token: string): Promise<{ ws: WebSocket; events: Array<{ event: string; data: any }>; next: (event: string) => Promise<any> }> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${t.port}/v1/ws`);
      const events: Array<{ event: string; data: any }> = [];
      const waiters: Array<{ event: string; resolve: (d: any) => void }> = [];
      ws.on('message', (raw) => {
        const f = JSON.parse(raw.toString());
        events.push(f);
        const i = waiters.findIndex((w) => w.event === f.event);
        if (i >= 0) waiters.splice(i, 1)[0]!.resolve(f.data);
        if (f.event === 'ready') resolve({ ws, events, next });
      });
      const next = (event: string) => {
        const seen = events.findIndex((e) => e.event === event);
        if (seen >= 0) return Promise.resolve(events.splice(seen, 1)[0]!.data);
        return new Promise((r, rej) => {
          waiters.push({ event, resolve: r });
          setTimeout(() => rej(new Error(`timeout waiting for ${event}`)), 3000);
        });
      };
      ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token })));
      ws.on('error', reject);
      ws.on('close', (code) => reject(new Error(`closed ${code}`)));
    });
  }

  describe('messaging', () => {
    it('sends, lists with cursor pagination, is idempotent and advances the journey', async () => {
      const { a, b, conversationId, matchId } = await matchedPair();
      const first = await send(a.auth, conversationId, 'Hi there!', { clientMessageId: 'fixed-client-id-1' }).expect(201);
      const again = await send(a.auth, conversationId, 'Hi there!', { clientMessageId: 'fixed-client-id-1' }).expect(201);
      expect(again.body.id).toBe(first.body.id);
      for (let i = 0; i < 3; i++) await send(b.auth, conversationId, `reply ${i}`).expect(201);

      const page1 = (await t.http.get(`/v1/conversations/${conversationId}/messages?limit=2`).set(a.auth).expect(200)).body;
      expect(page1.items.map((m: { body: string }) => m.body)).toEqual(['reply 2', 'reply 1']);
      const page2 = (await t.http.get(`/v1/conversations/${conversationId}/messages?limit=2&before=${page1.nextCursor}`).set(a.auth).expect(200)).body;
      expect(page2.items.map((m: { body: string }) => m.body)).toEqual(['reply 0', 'Hi there!']);

      const j = await t.db.selectFrom('relationship_journeys').select(['stage', 'conversation_at']).where('match_id', '=', matchId).executeTakeFirstOrThrow();
      expect(j).toMatchObject({ stage: 'conversation', conversation_at: expect.anything() });

      const list = (await t.http.get('/v1/conversations').set(a.auth).expect(200)).body;
      expect(list.items.find((c: { id: string }) => c.id === conversationId)).toMatchObject({ unreadCount: 3, participants: [{ userId: b.id }] });
      await t.http.post(`/v1/conversations/${conversationId}/read`).set(a.auth).send({ messageId: page1.items[0].id }).expect(204);
      expect((await t.http.get('/v1/conversations').set(a.auth)).body.items.find((c: { id: string }) => c.id === conversationId).unreadCount).toBe(0);
    });

    it('rejects outsiders, closes on unmatch and on block', async () => {
      const { a, b, conversationId, matchId } = await matchedPair();
      const outsider = await discoverableUser(t, { gender: 'man', seeking: ['woman'], ...HERE });
      await t.http.get(`/v1/conversations/${conversationId}/messages`).set(outsider.auth).expect(404);
      await send(outsider.auth, conversationId, 'hey').expect(404);

      await t.db.insertInto('blocks').values({ blocker_id: b.id, blocked_id: a.id }).execute();
      expect((await send(a.auth, conversationId, 'still there?').expect(409)).body.error.code).toBe('CONVERSATION_CLOSED');
      await t.db.deleteFrom('blocks').where('blocker_id', '=', b.id).execute();
      await t.http.post(`/v1/matches/${matchId}/unmatch`).set(b.auth).send({}).expect(204);
      expect((await send(a.auth, conversationId, 'hello?').expect(409)).body.error.code).toBe('CONVERSATION_CLOSED');
    });

    it('applies moderation rules: warns on scam phrases and withholds threats', async () => {
      const { a, b, conversationId } = await matchedPair();
      const warn = await send(a.auth, conversationId, 'Could you send money through Western Union?').expect(201);
      expect(warn.body.safetyWarning).toBe(true);
      const hidden = await send(a.auth, conversationId, 'I know where you live').expect(201);
      const seenByB = (await t.http.get(`/v1/conversations/${conversationId}/messages`).set(b.auth)).body.items.map((m: { id: string }) => m.id);
      expect(seenByB).toContain(warn.body.id);
      expect(seenByB).not.toContain(hidden.body.id);
      const signals = await t.db.selectFrom('safety_events').select('signal').where('user_id', '=', a.id).execute();
      expect(signals.map((s) => s.signal)).toEqual(expect.arrayContaining(['scam', 'violence']));
    });

    it('supports replies, reactions, delete-for-everyone and image messages via upload tokens', async () => {
      const { a, b, conversationId } = await matchedPair();
      const m = await send(a.auth, conversationId, 'Pick a cafe?').expect(201);
      const r = await send(b.auth, conversationId, 'The blue one', { replyToId: m.body.id }).expect(201);
      expect(r.body.replyToId).toBe(m.body.id);
      await t.http.post(`/v1/messages/${m.body.id}/reactions`).set(b.auth).send({ emoji: '❤️' }).expect(204);
      const withReaction = (await t.http.get(`/v1/conversations/${conversationId}/messages`).set(a.auth)).body.items.find((x: { id: string }) => x.id === m.body.id);
      expect(withReaction.reactions).toEqual([{ emoji: '❤️', userId: b.id }]);
      await t.http.delete(`/v1/messages/${m.body.id}`).set(b.auth).expect(404); // not the sender
      await t.http.delete(`/v1/messages/${m.body.id}`).set(a.auth).expect(204);

      const up = await t.http.post(`/v1/conversations/${conversationId}/uploads`).set(a.auth).send({ kind: 'image', mimeType: 'image/jpeg', byteSize: 2048 }).expect(201);
      expect((await send(a.auth, conversationId, '', { kind: 'image', body: undefined, uploadToken: up.body.uploadToken }).expect(409)).body.error.code).toBe('MEDIA_NOT_UPLOADED');
      const storage = t.app.get<InMemoryObjectStorage>(OBJECT_STORAGE);
      const key = JSON.parse(Buffer.from(up.body.uploadToken.split('.')[0], 'base64url').toString()).k;
      await storage.put(key, Buffer.alloc(1000), 'image/jpeg');
      const img = await send(a.auth, conversationId, '', { kind: 'image', body: undefined, uploadToken: up.body.uploadToken }).expect(201);
      expect(img.body.media[0]).toMatchObject({ kind: 'image', url: expect.stringContaining('memory://') });
      // When moderation finishes, both members get the message's new state (message.updated).
      const publish = jest.spyOn(t.app.get(RealtimeBus), 'publish');
      await drainOutbox(t);
      const update = publish.mock.calls.find(([, event, data]) => event === 'message.updated' && (data as { id: string }).id === img.body.id);
      publish.mockRestore();
      expect(update?.[0]).toEqual(expect.arrayContaining([a.id, b.id]));
      const forged = up.body.uploadToken.replace(/.$/, (c: string) => (c === 'A' ? 'B' : 'A'));
      expect((await send(b.auth, conversationId, '', { kind: 'image', body: undefined, uploadToken: forged }).expect(400)).body.error.code).toBe('UPLOAD_TOKEN_INVALID');
    });

    it('serves icebreakers based on what the pair shares', async () => {
      const { a, conversationId } = await matchedPair();
      const ice = (await t.http.get(`/v1/conversations/${conversationId}/icebreakers`).set(a.auth).expect(200)).body;
      expect(ice.map((i: { key: string }) => i.key)).toEqual(expect.arrayContaining(['shared_interest_any', 'shared_hiking', 'generic_hello']));
      expect(ice.find((i: { key: string }) => i.key === 'shared_interest_any').text).toMatch(/Hiking|Coffee|Reading/);
    });
  });

  describe('realtime', () => {
    it('authenticates with a first frame and delivers messages, typing and read receipts', async () => {
      const { a, b, conversationId } = await matchedPair();
      const sa = await connect(a.token);
      const sb = await connect(b.token);
      try {
        sb.ws.send(JSON.stringify({ type: 'typing', conversationId, isTyping: true }));
        expect(await sa.next('typing')).toMatchObject({ conversationId, userId: b.id, isTyping: true });

        const sent = await send(a.auth, conversationId, 'realtime hello').expect(201);
        expect((await sb.next('message.new')).id).toBe(sent.body.id);

        await t.http.post(`/v1/conversations/${conversationId}/read`).set(b.auth).send({ messageId: sent.body.id }).expect(204);
        expect(await sa.next('read')).toMatchObject({ messageId: sent.body.id, userId: b.id });

        sb.ws.send(JSON.stringify({ type: 'ping' }));
        expect(await sb.next('pong')).toHaveProperty('at');
      } finally {
        sa.ws.close();
        sb.ws.close();
      }
    });

    it('rejects sockets with a bad token', async () => {
      await expect(connect('not-a-token')).rejects.toThrow(/closed 4401/);
    });
  });

  describe('notifications', () => {
    it('creates in-app notifications for matches and offline messages, honouring preferences and mute', async () => {
      const { a, b, conversationId } = await matchedPair();
      await drainOutbox(t);
      const inbox = (await t.http.get('/v1/notifications').set(a.auth).expect(200)).body;
      expect(inbox.items[0]).toMatchObject({ category: 'match', title: "It's a match!", deepLink: expect.stringMatching(/^amora:\/\/matches\//) });

      await t.http.put('/v1/notifications/preferences').set(b.auth).send({ preferences: [{ category: 'message', channel: 'in_app', enabled: false }] }).expect(200);
      await send(a.auth, conversationId, 'ping 1').expect(201);
      await drainOutbox(t);
      expect((await t.http.get('/v1/notifications').set(b.auth)).body.items.filter((n: { category: string }) => n.category === 'message')).toHaveLength(0);

      await send(b.auth, conversationId, 'ping 2').expect(201);
      await drainOutbox(t);
      const aMsgs = (await t.http.get('/v1/notifications').set(a.auth)).body.items.filter((n: { category: string }) => n.category === 'message');
      expect(aMsgs[0]).toMatchObject({ body: 'sent you a message' });

      await t.http.post('/v1/notifications/read-all').set(a.auth).expect(204);
      expect((await t.http.get('/v1/notifications').set(a.auth)).body.unread).toBe(0);
    });

    it('defers non-critical notifications during quiet hours and suppresses push without devices/providers', async () => {
      const { a } = await matchedPair();
      const now = new Date();
      const hhmm = (d: Date) => `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
      await t.http.put('/v1/notifications/preferences').set(a.auth).send({ preferences: [], quietHours: { start: hhmm(new Date(now.getTime() - 3_600_000)), end: hhmm(new Date(now.getTime() + 3_600_000)), timezone: 'UTC' } }).expect(200);
      const svc = t.app.get(NotificationsService);
      await svc.notify(a.id, 'ai.recommendation', {}, { dedupeKey: 'quiet-test' });
      const push = await t.db.selectFrom('notifications').select(['status', 'scheduled_for']).where('user_id', '=', a.id).where('dedupe_key', '=', 'quiet-test').where('channel', '=', 'push').executeTakeFirstOrThrow();
      expect(push.status).toBe('deferred');
      expect(new Date(push.scheduled_for).getTime()).toBeGreaterThan(Date.now() + 30 * 60_000);

      await t.db.updateTable('notifications').set({ scheduled_for: new Date(Date.now() - 1000) }).where('user_id', '=', a.id).where('dedupe_key', '=', 'quiet-test').execute();
      await svc.dispatchDue();
      const after = await t.db.selectFrom('notifications').select(['status', 'last_error']).where('user_id', '=', a.id).where('dedupe_key', '=', 'quiet-test').where('channel', '=', 'push').executeTakeFirstOrThrow();
      expect(after).toMatchObject({ status: 'suppressed', last_error: 'no_push_devices' });
    });

    it('registers push tokens only for the caller’s own device', async () => {
      const { a } = await matchedPair();
      const dev = await t.db.selectFrom('user_devices').select('installation_id').where('user_id', '=', a.id).executeTakeFirstOrThrow();
      await t.http.post('/v1/devices/push-token').set(a.auth).send({ installationId: dev.installation_id, provider: 'fcm', token: 'fcm-token-1234567890' }).expect(204);
      await t.http.post('/v1/devices/push-token').set(a.auth).send({ installationId: 'someone-elses-install', provider: 'fcm', token: 'fcm-token-1234567890' }).expect(404);
    });

    it('lets admins version, publish, preview and test-send templates; validates variables', async () => {
      const admin = await adminSession(t, 'super_admin');
      await admin.as(t.http.put('/v1/admin/notifications/templates/test.hello')).send({ key: 'test.hello', category: 'system', channels: ['in_app'] }).expect(200);
      const bad = await admin.as(t.http.post('/v1/admin/notifications/templates/test.hello/versions')).send({ variables: [], contents: [{ locale: 'en', channel: 'in_app', title: 'Hi', body: 'Hello {{name}}' }] }).expect(400);
      expect(bad.body.error.message).toMatch(/Undeclared variables: name/);
      const v = await admin.as(t.http.post('/v1/admin/notifications/templates/test.hello/versions')).send({ variables: ['name'], contents: [{ locale: 'en', channel: 'in_app', title: 'Hi', body: 'Hello {{name}}' }, { locale: 'fr', channel: 'in_app', title: 'Salut', body: 'Bonjour {{name}}' }] }).expect(201);
      await admin.as(t.http.post(`/v1/admin/notifications/templates/test.hello/versions/${v.body.version}/publish`)).send({}).expect(200);
      const prev = await admin.as(t.http.post('/v1/admin/notifications/templates/test.hello/preview')).send({ locale: 'fr-CA', channel: 'in_app', variables: { name: 'Léa' } }).expect(200);
      expect(prev.body).toMatchObject({ locale: 'fr', body: 'Bonjour Léa' });
      const { a } = await matchedPair();
      expect((await admin.as(t.http.post('/v1/admin/notifications/templates/test.hello/test-send')).send({ userId: a.id, variables: { name: 'A' } }).expect(200)).body.created).toBe(1);
      expect((await admin.as(t.http.post('/v1/admin/notifications/broadcast')).send({ templateKey: 'system.announcement', countryCodes: ['US'], dryRun: true }).expect(200)).body.audienceUpperBound).toBeGreaterThan(0);
      const analyst = await adminSession(t, 'analyst');
      await analyst.as(t.http.get('/v1/admin/notifications/templates')).expect(403);
    });
  });
});
