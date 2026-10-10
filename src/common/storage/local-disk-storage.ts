import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { ObjectHead, ObjectStorage } from './object-storage';

/**
 * Development-only object storage on the local disk (S3_BUCKET=local), for machines without S3/MinIO.
 * Signed URLs point at the API's own `/v1/dev-storage/*` routes and carry an expiring HMAC, so clients use exactly
 * the same signed-URL flow as with S3. Config validation refuses this adapter in production.
 */
export class LocalDiskObjectStorage implements ObjectStorage {
  private readonly root: string;

  constructor(root: string, private readonly publicBaseUrl: string, private readonly secret: string) {
    this.root = resolve(root);
  }

  /** Maps a key to a path inside the root; rejects traversal. */
  path(key: string): string {
    const p = resolve(this.root, key);
    if (!p.startsWith(this.root + sep)) throw new Error('invalid storage key');
    return p;
  }

  sign(op: 'get' | 'put', key: string, exp: number, extra = ''): string {
    return createHmac('sha256', this.secret).update(`${op}\n${key}\n${exp}\n${extra}`).digest('base64url');
  }

  verify(op: 'get' | 'put', key: string, exp: number, sig: string, extra = ''): boolean {
    if (!Number.isFinite(exp) || exp < Date.now()) return false;
    const want = Buffer.from(this.sign(op, key, exp, extra));
    const got = Buffer.from(sig);
    return want.length === got.length && timingSafeEqual(want, got);
  }

  private url(op: 'get' | 'put', key: string, ttlSeconds: number, params: Record<string, string> = {}): string {
    const exp = Date.now() + ttlSeconds * 1000;
    const extra = op === 'put' ? `${params.ct}\n${params.max}` : '';
    const q = new URLSearchParams({ ...params, exp: String(exp), sig: this.sign(op, key, exp, extra) });
    return `${this.publicBaseUrl.replace(/\/$/, '')}/v1/dev-storage/${op}/${key.split('/').map(encodeURIComponent).join('/')}?${q}`;
  }

  async signedUploadUrl(key: string, contentType: string, byteSize: number, ttlSeconds: number): Promise<string> {
    return this.url('put', key, ttlSeconds, { ct: contentType, max: String(byteSize) });
  }

  async signedDownloadUrl(key: string, ttlSeconds: number): Promise<string> {
    return this.url('get', key, ttlSeconds);
  }

  async head(key: string): Promise<ObjectHead | null> {
    try {
      const s = await stat(this.path(key));
      const meta = await readFile(`${this.path(key)}.meta.json`, 'utf8').then((m) => JSON.parse(m) as { contentType: string }).catch(() => null);
      return { byteSize: s.size, contentType: meta?.contentType ?? null };
    } catch {
      return null;
    }
  }

  get(key: string): Promise<Buffer> {
    return readFile(this.path(key));
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, body);
    await writeFile(`${p}.meta.json`, JSON.stringify({ contentType }));
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
    await rm(`${this.path(key)}.meta.json`, { force: true });
  }
}

