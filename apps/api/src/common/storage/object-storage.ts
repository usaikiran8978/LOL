import { AppError } from '../errors/app-error';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface ObjectHead {
  byteSize: number;
  contentType: string | null;
}

/**
 * Object storage abstraction (S3-compatible: AWS S3, Cloudflare R2, GCS interop, MinIO).
 * Clients never get bucket credentials — only short-lived signed URLs (TECH §15).
 */
export interface ObjectStorage {
  signedUploadUrl(key: string, contentType: string, byteSize: number, ttlSeconds: number): Promise<string>;
  signedDownloadUrl(key: string, ttlSeconds: number): Promise<string>;
  head(key: string): Promise<ObjectHead | null>;
  get(key: string): Promise<Buffer>;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;

  constructor(private readonly bucket: string, opts: { region: string; endpoint?: string; forcePathStyle?: boolean; accessKeyId?: string; secretAccessKey?: string }) {
    this.client = new S3Client({
      region: opts.region,
      endpoint: opts.endpoint,
      forcePathStyle: opts.forcePathStyle,
      credentials: opts.accessKeyId && opts.secretAccessKey ? { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey } : undefined,
    });
  }

  signedUploadUrl(key: string, contentType: string, byteSize: number, ttlSeconds: number): Promise<string> {
    return getSignedUrl(this.client, new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType, ContentLength: byteSize }), { expiresIn: ttlSeconds });
  }

  signedDownloadUrl(key: string, ttlSeconds: number): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: ttlSeconds });
  }

  async head(key: string): Promise<ObjectHead | null> {
    try {
      const r = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { byteSize: r.ContentLength ?? 0, contentType: r.ContentType ?? null };
    } catch (err) {
      if ((err as { name?: string }).name === 'NotFound' || (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return null;
      throw err;
    }
  }

  async get(key: string): Promise<Buffer> {
    const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

/** Used only when no bucket is configured: every call fails loudly with STORAGE_NOT_CONFIGURED. */
export class UnconfiguredObjectStorage implements ObjectStorage {
  private fail(): never {
    throw new AppError('STORAGE_NOT_CONFIGURED', 'Object storage is not configured (set S3_BUCKET)');
  }
  signedUploadUrl(): Promise<string> { return this.fail(); }
  signedDownloadUrl(): Promise<string> { return this.fail(); }
  head(): Promise<ObjectHead | null> { return this.fail(); }
  get(): Promise<Buffer> { return this.fail(); }
  put(): Promise<void> { return this.fail(); }
  delete(): Promise<void> { return this.fail(); }
}

/**
 * In-memory storage for the automated test suite only (selected with S3_BUCKET=memory and NODE_ENV=test;
 * config validation rejects it elsewhere). Tests upload by calling `put` directly.
 */
export class InMemoryObjectStorage implements ObjectStorage {
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();
  async signedUploadUrl(key: string): Promise<string> { return `memory://upload/${key}`; }
  async signedDownloadUrl(key: string): Promise<string> { return `memory://download/${key}`; }
  async head(key: string): Promise<ObjectHead | null> {
    const o = this.objects.get(key);
    return o ? { byteSize: o.body.length, contentType: o.contentType } : null;
  }
  async get(key: string): Promise<Buffer> {
    const o = this.objects.get(key);
    if (!o) throw new Error(`no object ${key}`);
    return o.body;
  }
  async put(key: string, body: Buffer, contentType: string): Promise<void> { this.objects.set(key, { body, contentType }); }
  async delete(key: string): Promise<void> { this.objects.delete(key); }
}
