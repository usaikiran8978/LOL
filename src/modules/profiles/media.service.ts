import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import sharp from 'sharp';
import { sql } from 'kysely';
import { AnalyticsService } from '../../common/analytics/analytics.service';
import { JobScheduler } from '../../common/jobs/scheduler';
import { APP_CONFIG, type AppConfig } from '../../common/config/config';
import { DATABASE, type Database } from '../../common/db/database';
import { AppError } from '../../common/errors/app-error';
import { OutboxService } from '../../common/outbox/outbox.service';
import { OBJECT_STORAGE, type ObjectStorage } from '../../common/storage/object-storage';
import { SettingsService } from '../platform/settings.service';
import { ProfileStateService } from './profile-state.service';

type Kind = 'photo' | 'video' | 'voice';

const MIME: Record<Kind, string[]> = {
  photo: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
  video: ['video/mp4', 'video/quicktime'],
  voice: ['audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/aac', 'audio/mpeg', 'audio/webm', 'audio/ogg'],
};
// Defaults; admins override via system_settings `media.limits`.
const DEFAULT_LIMITS: Record<Kind, { maxCount: number; maxBytes: number }> = {
  photo: { maxCount: 9, maxBytes: 15 * 1024 * 1024 },
  video: { maxCount: 3, maxBytes: 100 * 1024 * 1024 },
  voice: { maxCount: 1, maxBytes: 5 * 1024 * 1024 },
};

export interface MediaDto {
  id: string;
  kind: Kind;
  position: number;
  processingStatus: string;
  moderationStatus: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  caption: string | null;
  url: string | null;
  thumbUrl: string | null;
}

/** 64-bit difference hash: robust to resizing/re-encoding; used for duplicate / stolen photo detection (BRD §15). */
export async function dHash(image: Buffer): Promise<Buffer> {
  const px = await sharp(image).grayscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
  const out = Buffer.alloc(8);
  for (let y = 0; y < 8; y++) {
    let byte = 0;
    for (let x = 0; x < 8; x++) byte = (byte << 1) | (px[y * 9 + x]! > px[y * 9 + x + 1]! ? 1 : 0);
    out[y] = byte;
  }
  return out;
}

@Injectable()
export class MediaService implements OnModuleInit {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly outbox: OutboxService,
    private readonly settings: SettingsService,
    private readonly state: ProfileStateService,
    private readonly analytics: AnalyticsService,
    private readonly jobs: JobScheduler,
  ) {}

  onModuleInit(): void {
    this.outbox.on('media.uploaded', (p) => this.process(String(p.mediaId)));
    this.outbox.on('media.deleted', (p) => this.purge(p.keys as string[]));
    // Uploads never confirmed (app killed, network lost) stop counting toward limits after an hour.
    this.jobs.register('media.abandoned_uploads', 900, async () => {
      const stale = await this.db.updateTable('profile_media').set({ deleted_at: new Date(), processing_status: 'failed' })
        .where('processing_status', '=', 'uploading').where('created_at', '<', new Date(Date.now() - 3_600_000)).where('deleted_at', 'is', null).returning('storage_key').execute();
      for (const s of stale) await this.storage.delete(s.storage_key).catch(() => undefined);
    });
  }

  private async limits(): Promise<typeof DEFAULT_LIMITS> {
    return { ...DEFAULT_LIMITS, ...(await this.settings.get<Partial<typeof DEFAULT_LIMITS>>('media.limits', {})) };
  }

  async requestUpload(userId: string, kind: Kind, mimeType: string, byteSize: number) {
    if (!MIME[kind].includes(mimeType)) throw new AppError('MEDIA_TYPE_NOT_ALLOWED', undefined, { allowed: MIME[kind] });
    const limit = (await this.limits())[kind];
    if (byteSize > limit.maxBytes) throw new AppError('MEDIA_TOO_LARGE', undefined, { maxBytes: limit.maxBytes });
    const { count } = await this.db
      .selectFrom('profile_media')
      .select(sql<number>`count(*)::int`.as('count'))
      .where('user_id', '=', userId)
      .where('kind', '=', kind)
      .where('deleted_at', 'is', null)
      .where('processing_status', '<>', 'failed')
      .where((eb) => eb.or([eb('processing_status', '<>', 'uploading'), eb('created_at', '>', new Date(Date.now() - 3_600_000))]))
      .executeTakeFirstOrThrow();
    if (count >= limit.maxCount) throw new AppError('MEDIA_LIMIT_REACHED', undefined, { maxCount: limit.maxCount });

    const key = `u/${userId}/${kind}/${randomUUID()}`;
    const uploadUrl = await this.storage.signedUploadUrl(key, mimeType, byteSize, this.cfg.MEDIA_UPLOAD_URL_TTL_SECONDS);
    const row = await this.db
      .insertInto('profile_media')
      .values({ user_id: userId, kind, storage_key: key, mime_type: mimeType, byte_size: byteSize, position: count })
      .returning('id')
      .executeTakeFirstOrThrow();
    return {
      mediaId: row.id,
      uploadUrl,
      method: 'PUT',
      headers: { 'Content-Type': mimeType },
      expiresAt: new Date(Date.now() + this.cfg.MEDIA_UPLOAD_URL_TTL_SECONDS * 1000).toISOString(),
    };
  }

  async confirm(userId: string, mediaId: string, caption?: string): Promise<MediaDto> {
    const row = await this.owned(userId, mediaId);
    if (row.processing_status !== 'uploading') throw new AppError('CONFLICT', 'Upload already confirmed');
    const head = await this.storage.head(row.storage_key);
    if (!head) throw new AppError('MEDIA_NOT_UPLOADED');
    if (head.byteSize > Number(row.byte_size)) {
      await this.storage.delete(row.storage_key);
      throw new AppError('MEDIA_TOO_LARGE');
    }
    await this.db.transaction().execute(async (trx) => {
      await trx.updateTable('profile_media').set({ processing_status: 'processing', byte_size: head.byteSize, caption: caption ?? null }).where('id', '=', mediaId).execute();
      await this.outbox.enqueue(trx, 'media.uploaded', { mediaId }, { aggregateId: mediaId });
    });
    await this.analytics.track('media_uploaded', { userId, properties: { kind: row.kind } });
    return this.toDto(await this.owned(userId, mediaId));
  }

  /** Worker: strip metadata (EXIF GPS!), normalise orientation, build variants, fingerprint. */
  async process(mediaId: string): Promise<void> {
    const row = await this.db.selectFrom('profile_media').selectAll().where('id', '=', mediaId).executeTakeFirst();
    if (!row || row.deleted_at || row.processing_status !== 'processing') return;
    try {
      if (row.kind === 'photo') {
        const original = await this.storage.get(row.storage_key);
        const base = sharp(original, { failOn: 'error' }).rotate(); // apply EXIF orientation; metadata is dropped on output
        const display = await base.clone().resize(1440, 1440, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85, mozjpeg: true }).toBuffer({ resolveWithObject: true });
        const thumb = await base.clone().resize(360, 360, { fit: 'cover' }).jpeg({ quality: 80 }).toBuffer();
        const thumbKey = `${row.storage_key}/thumb.jpg`;
        // Overwrite the original so no copy with location metadata remains.
        await this.storage.put(row.storage_key, display.data, 'image/jpeg');
        await this.storage.put(thumbKey, thumb, 'image/jpeg');
        const phash = await dHash(display.data);
        await this.db
          .updateTable('profile_media')
          .set({
            processing_status: 'ready', mime_type: 'image/jpeg', byte_size: display.data.length, width: display.info.width, height: display.info.height,
            variants: JSON.stringify({ thumb: thumbKey }), perceptual_hash: phash, moderation_status: 'pending',
          })
          .where('id', '=', mediaId)
          .execute();
        await this.flagDuplicates(row.user_id, mediaId, phash);
      } else {
        // Video/voice: transcoding + duration probing require the media pipeline (ffmpeg worker / provider) — see
        // docs/progress.md. Until then they are stored as uploaded and always routed to human review.
        await this.db.updateTable('profile_media').set({ processing_status: 'ready', moderation_status: 'needs_review' }).where('id', '=', mediaId).execute();
      }
      await this.outbox.enqueue(this.db, 'media.ready', { mediaId, userId: row.user_id, kind: row.kind }, { aggregateId: mediaId });
      await this.state.recompute(row.user_id);
    } catch (err) {
      this.logger.warn(`media ${mediaId} processing failed: ${(err as Error).message}`);
      await this.db.updateTable('profile_media').set({ processing_status: 'failed' }).where('id', '=', mediaId).execute();
    }
  }

  private async flagDuplicates(userId: string, mediaId: string, phash: Buffer): Promise<void> {
    const dupes = await this.db
      .selectFrom('profile_media')
      .select(['id', 'user_id'])
      .where('perceptual_hash', '=', phash)
      .where('user_id', '<>', userId)
      .where('deleted_at', 'is', null)
      .limit(5)
      .execute();
    if (dupes.length === 0) return;
    await this.db
      .insertInto('safety_events')
      .values({ user_id: userId, signal: 'duplicate_account', source: 'media.dhash', score: 1, ref_type: 'profile_media', ref_id: mediaId, details: JSON.stringify({ matches: dupes }) })
      .execute();
  }

  async list(userId: string): Promise<MediaDto[]> {
    const rows = await this.db.selectFrom('profile_media').selectAll().where('user_id', '=', userId).where('deleted_at', 'is', null).orderBy('kind').orderBy('position').execute();
    return Promise.all(rows.map((r) => this.toDto(r)));
  }

  /** Media other users may see: approved + ready only. */
  async publicMedia(userId: string): Promise<MediaDto[]> {
    const rows = await this.db
      .selectFrom('profile_media')
      .selectAll()
      .where('user_id', '=', userId)
      .where('deleted_at', 'is', null)
      .where('processing_status', '=', 'ready')
      .where('moderation_status', '=', 'approved')
      .orderBy('kind')
      .orderBy('position')
      .execute();
    return Promise.all(rows.map((r) => this.toDto(r)));
  }

  async reorder(userId: string, ids: string[]): Promise<MediaDto[]> {
    const owned = await this.db.selectFrom('profile_media').select(['id', 'kind']).where('user_id', '=', userId).where('id', 'in', ids).where('deleted_at', 'is', null).execute();
    if (owned.length !== ids.length || new Set(owned.map((o) => o.kind)).size !== 1) throw new AppError('VALIDATION_FAILED', 'All ids must be your media of one kind');
    await this.db.transaction().execute(async (trx) => {
      for (const [i, id] of ids.entries()) await trx.updateTable('profile_media').set({ position: i }).where('id', '=', id).execute();
    });
    await this.state.recompute(userId);
    return this.list(userId);
  }

  async remove(userId: string, mediaId: string): Promise<void> {
    const row = await this.owned(userId, mediaId);
    const variants = Object.values((row.variants ?? {}) as Record<string, string>);
    await this.db.transaction().execute(async (trx) => {
      await trx.updateTable('profile_media').set({ deleted_at: new Date() }).where('id', '=', mediaId).execute();
      await this.outbox.enqueue(trx, 'media.deleted', { keys: [row.storage_key, ...variants] }, { aggregateId: mediaId });
    });
    await this.state.recompute(userId);
  }

  private async purge(keys: string[]): Promise<void> {
    for (const k of keys) await this.storage.delete(k);
  }

  private async owned(userId: string, mediaId: string) {
    const row = await this.db.selectFrom('profile_media').selectAll().where('id', '=', mediaId).where('user_id', '=', userId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!row) throw new AppError('NOT_FOUND');
    return row;
  }

  private async toDto(r: { id: string; kind: string; position: number; processing_status: string; moderation_status: string; width: number | null; height: number | null; duration_ms: number | null; caption: string | null; storage_key: string; variants: unknown }): Promise<MediaDto> {
    const ready = r.processing_status === 'ready';
    const ttl = this.cfg.MEDIA_DOWNLOAD_URL_TTL_SECONDS;
    const thumbKey = (r.variants as Record<string, string> | null)?.thumb;
    return {
      id: r.id,
      kind: r.kind as Kind,
      position: r.position,
      processingStatus: r.processing_status,
      moderationStatus: r.moderation_status,
      width: r.width,
      height: r.height,
      durationMs: r.duration_ms,
      caption: r.caption,
      url: ready ? await this.storage.signedDownloadUrl(r.storage_key, ttl) : null,
      thumbUrl: ready && thumbKey ? await this.storage.signedDownloadUrl(thumbKey, ttl) : null,
    };
  }
}
