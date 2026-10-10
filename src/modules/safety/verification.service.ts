import { randomInt, randomUUID } from 'node:crypto';
import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { AnalyticsService } from '../../common/analytics/analytics.service';
import { AuditService } from '../../common/audit/audit.service';
import { APP_CONFIG, type AppConfig } from '../../common/config/config';
import { DATABASE, type Database } from '../../common/db/database';
import { AppError } from '../../common/errors/app-error';
import type { ClientContext } from '../../common/http/request-context';
import { JobScheduler } from '../../common/jobs/scheduler';
import { OutboxService } from '../../common/outbox/outbox.service';
import { OBJECT_STORAGE, type ObjectStorage } from '../../common/storage/object-storage';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../platform/settings.service';
import { ProfileStateService } from '../profiles/profile-state.service';

const POSES = ['thumbs_up_left', 'thumbs_up_right', 'peace_sign', 'hand_on_chin', 'wave', 'point_up'];
const ACTIVE = ['pending', 'processing', 'needs_review'] as const;

/**
 * Verification provider abstraction. `manual_review` (built in) routes every submission to the T&S verification
 * queue. External liveness/ID vendors (Onfido, Veriff, AWS Rekognition FaceLiveness…) implement this interface and
 * post their result back through `complete()`; credentials are configured per environment.
 */
export interface VerificationProvider {
  readonly key: string;
  submit(req: { id: string; userId: string; kind: 'selfie' | 'identity'; evidenceKeys: string[]; poseChallenge: string | null }): Promise<{ status: 'processing' | 'needs_review'; providerRef: string | null }>;
}

class ManualReviewProvider implements VerificationProvider {
  readonly key = 'manual_review';
  async submit() {
    return { status: 'needs_review' as const, providerRef: null };
  }
}

@Injectable()
export class VerificationService implements OnModuleInit {
  private readonly providers = new Map<string, VerificationProvider>([['manual_review', new ManualReviewProvider()]]);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly outbox: OutboxService,
    private readonly notifications: NotificationsService,
    private readonly profileState: ProfileStateService,
    private readonly settings: SettingsService,
    private readonly analytics: AnalyticsService,
    private readonly audit: AuditService,
    private readonly jobs: JobScheduler,
  ) {}

  onModuleInit(): void {
    this.outbox.on('verification.submitted', (p) => this.dispatch(String(p.requestId)));
    // Reverification (MP §16): approvals expire; the badge is removed and the user is invited to verify again.
    this.jobs.register('verification.expire', 24 * 3600, async () => {
      const expired = await this.db.selectFrom('verification_requests').select(['id', 'user_id']).where('status', '=', 'approved').where('expires_at', '<=', new Date()).execute();
      for (const r of expired) {
        await this.db.updateTable('verification_requests').set({ status: 'expired' }).where('id', '=', r.id).execute();
        await this.db.updateTable('user_profiles').set({ verification_level: 'none' }).where('user_id', '=', r.user_id).execute();
        await this.notifications.notify(r.user_id, 'verification.result', { result: 'expired' }, { dedupeKey: `verification:expired:${r.id}` });
        await this.profileState.recompute(r.user_id);
      }
    });
  }

  registerProvider(p: VerificationProvider): void {
    this.providers.set(p.key, p);
  }

  private async consentGiven(userId: string, type: string): Promise<boolean> {
    const c = await this.db.selectFrom('consent_records').select('granted').where('user_id', '=', userId).where('consent_type', '=', type).orderBy('created_at', 'desc').limit(1).executeTakeFirst();
    return !!c?.granted;
  }

  async start(userId: string, kind: 'selfie' | 'identity') {
    if (kind === 'identity') {
      const c = await this.db.selectFrom('users as u').leftJoin('country_configs as cc', 'cc.country_code', 'u.country_code').select('cc.identity_verification_available').where('u.id', '=', userId).executeTakeFirstOrThrow();
      if (!c.identity_verification_available) throw new AppError('NOT_AVAILABLE_IN_COUNTRY');
    }
    const consentType = kind === 'selfie' ? 'biometric_verification' : 'identity_verification';
    if (!(await this.consentGiven(userId, consentType))) throw new AppError('CONSENT_REQUIRED', undefined, { consentType });
    const active = await this.db.selectFrom('verification_requests').select(['id', 'status']).where('user_id', '=', userId).where('kind', '=', kind).where('status', 'in', [...ACTIVE]).executeTakeFirst();
    if (active && active.status !== 'pending') throw new AppError('VERIFICATION_IN_PROGRESS', undefined, { requestId: active.id });
    if (active) await this.db.updateTable('verification_requests').set({ status: 'cancelled' }).where('id', '=', active.id).execute();
    const provider = await this.settings.get<string>(`verification.provider.${kind}`, 'manual_review');
    const req = await this.db.insertInto('verification_requests').values({ user_id: userId, kind, provider, pose_challenge: kind === 'selfie' ? POSES[randomInt(POSES.length)]! : null })
      .returning(['id', 'kind', 'pose_challenge', 'status']).executeTakeFirstOrThrow();
    await this.analytics.track('verification_started', { userId, properties: { kind } });
    return { requestId: req.id, kind: req.kind, poseChallenge: req.pose_challenge, status: req.status };
  }

  async evidenceUpload(userId: string, requestId: string, mimeType: string, byteSize: number) {
    const req = await this.owned(userId, requestId);
    if (req.status !== 'pending') throw new AppError('CONFLICT', 'Request already submitted');
    if (req.evidence_keys.length >= 4) throw new AppError('LIMIT_REACHED', 'Too many evidence files');
    // Separate prefix so the bucket policy can restrict verification evidence to the T&S service role.
    const key = `v/${userId}/${requestId}/${randomUUID()}`;
    const uploadUrl = await this.storage.signedUploadUrl(key, mimeType, byteSize, this.cfg.MEDIA_UPLOAD_URL_TTL_SECONDS);
    await this.db.updateTable('verification_requests').set({ evidence_keys: [...req.evidence_keys, key] }).where('id', '=', requestId).execute();
    return { uploadUrl, method: 'PUT', headers: { 'Content-Type': mimeType } };
  }

  async submit(userId: string, requestId: string) {
    const req = await this.owned(userId, requestId);
    if (req.status !== 'pending') throw new AppError('CONFLICT', 'Request already submitted');
    const present: string[] = [];
    for (const k of req.evidence_keys) if (await this.storage.head(k)) present.push(k);
    if (!present.length) throw new AppError('MEDIA_NOT_UPLOADED');
    await this.db.transaction().execute(async (trx) => {
      await trx.updateTable('verification_requests').set({ status: 'processing', evidence_keys: present, submitted_at: new Date() }).where('id', '=', requestId).execute();
      await this.outbox.enqueue(trx, 'verification.submitted', { requestId }, { aggregateId: userId });
    });
    return this.status(userId);
  }

  private async dispatch(requestId: string): Promise<void> {
    const r = await this.db.selectFrom('verification_requests').selectAll().where('id', '=', requestId).executeTakeFirst();
    if (!r || r.status !== 'processing') return;
    const provider = this.providers.get(r.provider) ?? this.providers.get('manual_review')!;
    const res = await provider.submit({ id: r.id, userId: r.user_id, kind: r.kind as 'selfie' | 'identity', evidenceKeys: r.evidence_keys, poseChallenge: r.pose_challenge });
    await this.db.updateTable('verification_requests').set({ status: res.status, provider_ref: res.providerRef }).where('id', '=', requestId).execute();
  }

  async status(userId: string) {
    const [level, reqs] = await Promise.all([
      this.db.selectFrom('user_profiles').select('verification_level').where('user_id', '=', userId).executeTakeFirst(),
      this.db.selectFrom('verification_requests').select(['id', 'kind', 'status', 'pose_challenge', 'rejection_reason_key', 'submitted_at', 'decided_at', 'expires_at']).where('user_id', '=', userId).orderBy('submitted_at', 'desc').limit(10).execute(),
    ]);
    return {
      level: level?.verification_level ?? 'none',
      history: reqs.map((r) => ({
        id: r.id, kind: r.kind, status: r.status, poseChallenge: r.status === 'pending' ? r.pose_challenge : null, rejectionReasonKey: r.rejection_reason_key,
        submittedAt: new Date(r.submitted_at).toISOString(), decidedAt: r.decided_at ? new Date(r.decided_at).toISOString() : null, expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : null,
      })),
    };
  }

  /** Called by the admin queue (human review) or a vendor webhook adapter. */
  async complete(requestId: string, decision: 'approved' | 'rejected', actor: { type: 'admin' | 'system'; id: string | null }, rejectionReasonKey: string | undefined, client?: ClientContext) {
    const r = await this.db.selectFrom('verification_requests').selectAll().where('id', '=', requestId).executeTakeFirst();
    if (!r) throw new AppError('NOT_FOUND');
    if (!['processing', 'needs_review'].includes(r.status)) throw new AppError('CONFLICT', `Request is ${r.status}`);
    const validDays = await this.settings.get<number>('verification.valid_days', 365);
    await this.db.transaction().execute(async (trx) => {
      await trx.updateTable('verification_requests').set({
        status: decision, decided_at: new Date(), reviewer_id: actor.type === 'admin' ? actor.id : null, rejection_reason_key: decision === 'rejected' ? (rejectionReasonKey ?? 'not_matching') : null,
        expires_at: decision === 'approved' ? new Date(Date.now() + validDays * 86_400_000) : null,
      }).where('id', '=', requestId).execute();
      if (decision === 'approved') {
        const current = await trx.selectFrom('user_profiles').select('verification_level').where('user_id', '=', r.user_id).executeTakeFirst();
        // Identity outranks selfie; never downgrade.
        const level = r.kind === 'identity' || current?.verification_level === 'identity' ? 'identity' : 'selfie';
        await trx.updateTable('user_profiles').set({ verification_level: level }).where('user_id', '=', r.user_id).execute();
      }
      await this.audit.record({ actorType: actor.type, actorId: actor.id, action: `verification.${decision}`, targetType: 'verification_request', targetId: requestId, after: { userId: r.user_id, kind: r.kind, reason: rejectionReasonKey ?? null }, client }, trx);
    });
    await this.notifications.notify(r.user_id, 'verification.result', { result: decision }, { dedupeKey: `verification:${requestId}` });
    await this.analytics.track('verification_completed', { userId: r.user_id, properties: { kind: r.kind, decision } });
    await this.profileState.recompute(r.user_id);
  }

  private async owned(userId: string, requestId: string) {
    const r = await this.db.selectFrom('verification_requests').selectAll().where('id', '=', requestId).where('user_id', '=', userId).executeTakeFirst();
    if (!r) throw new AppError('NOT_FOUND');
    return r;
  }
}
