import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OBJECT_STORAGE, type ObjectStorage } from '../src/common/storage/object-storage';
import { loadConfig } from '../src/common/config/config';
import { createTestApp, type TestApp } from './helpers';
import { testEnv } from './env';

describe('Development disk storage (e2e)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'amora-store-'));
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ S3_BUCKET: 'local', LOCAL_STORAGE_DIR: dir, PUBLIC_API_URL: 'http://api.test' });
  });
  afterAll(async () => {
    await t.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const path = (url: string) => url.replace('http://api.test', '');

  it('accepts uploads only through valid signed URLs with the signed type and size, and serves signed downloads', async () => {
    const storage = t.app.get<ObjectStorage>(OBJECT_STORAGE);
    const up = await storage.signedUploadUrl('u/1/photo.jpg', 'image/jpeg', 10, 600);
    await t.http.put(path(up)).set('Content-Type', 'image/png').send(Buffer.alloc(10)).expect(400);
    await t.http.put(path(up)).set('Content-Type', 'image/jpeg').send(Buffer.alloc(11)).expect(413);
    await t.http.put(path(up).replace(/sig=[^&]+/, 'sig=forged')).set('Content-Type', 'image/jpeg').send(Buffer.alloc(10)).expect(403);
    await t.http.put(path(up)).set('Content-Type', 'image/jpeg').send(Buffer.from('0123456789')).expect(200);
    expect(await storage.head('u/1/photo.jpg')).toEqual({ byteSize: 10, contentType: 'image/jpeg' });
    const down = await storage.signedDownloadUrl('u/1/photo.jpg', 60);
    const r = await t.http.get(path(down)).expect(200);
    expect(r.headers['content-type']).toBe('image/jpeg');
    await t.http.get(path(down).replace('photo.jpg', '..%2F..%2Fsecret')).expect(403);
  });

  it('is refused in production', () => {
    expect(() => loadConfig({ ...testEnv({ S3_BUCKET: 'local' }), NODE_ENV: 'production' })).toThrow(/development-only/);
  });
});
