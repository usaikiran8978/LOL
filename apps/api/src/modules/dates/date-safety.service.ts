import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import type { z } from 'zod';
import type { safetySessionStart, trustedContactCreate } from '@amora/shared';
import { AnalyticsService } from '../../common/analytics/analytics.service';
import { AuditService } from '../../common/audit/audit.service';
import { APP_CONFIG, type AppConfig } from '../../common/config/config';
import { FIELD_ENCRYPTION, FieldEncryption } from '../../common/crypto/field-encryption';
import { randomToken, sha256 } from '../../common/crypto/tokens';
import { DATABASE, type Database } from '../../common/db/database';
import { AppError } from '../../common/errors/app-error';
import { JobScheduler } from '../../common/jobs/scheduler';
import { MessagingService } from '../../common/messaging/messaging';
import { OutboxService } from '../../common/outbox/outbox.service';
import { NotificationsService } from '../notifications/notifications.service';
import { FlagsService } from '../platform/flags.service';
import { SettingsService } from '../platform/settings.service';
import { UserFactsService } from '../platform/user-facts.service';
import { ModerationService } from '../safety/moderation.service';

/** Admin-managed (Admin → Dates → Safety settings, `date_safety.manage`); these are only the fallbacks. */
export const DATE_SAFETY_SETTINGS = {
  'date_safety.escalate_after_overdue_min': { fallback: 15, min: 5, max: 120, description: 'Minutes after a missed check-in before the trusted contact and Trust & Safety are alerted' },
  'date_safety.recheck_after_min': { fallback: 30, min: 10, max: 240, description: 'New check-in window when someone checks in after their deadline' },
  'date_safety.max_trusted_contacts': { fallback: 5, min: 1, max: 10, description: 'Trusted contacts a member can add' },
  'date_safety.invite_resend_cooldown_min': { fallback: 10, min: 1, max: 1440, description: 'Minimum minutes between trusted-contact invite resends' },
} as const;
export type DateSafetySettingKey = keyof typeof DATE_SAFETY_SETTINGS;
const INVITE_TTL_MS = 7 * 86_400_000;
const SHARE_LINK_GRACE_MS = 24 * 3_600_000;

/**
 * Date safety mode (BRD §14–15, MP §20, DEC-016): trusted contacts (encrypted at rest, must confirm before receiving
 * alerts), check-in/check-out timers, SOS, automatic escalation to the trusted contact and Trust & Safety when a
 * check-in is missed. Live location is shared with the trusted contact only — never with the date.
 */
@Injectable()
export class DateSafetyService implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(FIELD_ENCRYPTION) private readonly enc: FieldEncryption,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly notifications: NotificationsService,
    private readonly messaging: MessagingService,
    private readonly moderation: ModerationService,
    private readonly outbox: OutboxService,
    private readonly analytics: AnalyticsService,
    private readonly audit: AuditService,
    private readonly flags: FlagsService,
    private readonly facts: UserFactsService,
    private readonly jobs: JobScheduler,
    private readonly settings: SettingsService,
  ) {}

  private setting(key: DateSafetySettingKey): Promise<number> {
    return this.settings.get<number>(key, DATE_SAFETY_SETTINGS[key].fallback);
  }

  onModuleInit(): void {
    this.jobs.register('date_safety.overdue', 60, () => this.overdueSweep());
    this.outbox.on('safety.date_concern', async (p) => {
      const caseId = await this.db.transaction().execute((trx) => this.moderation.openOrAttachCase(trx, String(p.subjectId), 'offline_safety', p.severe ? 'critical' : 'high', 'user_report'));
      await this.db.insertInto('case_evidence').values({ case_id: caseId, kind: 'note_attachment', ref_id: String(p.datePlanId), snapshot: JSON.stringify({ reporterId: p.reporterId, source: 'date_feedback' }) }).execute();
    });
  }

  private async gate(userId: string) {
    await this.flags.assertEnabled('date_safety', await this.facts.load(userId));
  }

  private link(token: string) {
    return `${this.cfg.PUBLIC_WEB_URL.replace(/\/$/, '')}/safety/${token}`;
  }

  // ------------------------------------------------------------------------------------ trusted contacts

  async addContact(userId: string, input: z.infer<typeof trustedContactCreate>) {
    await this.gate(userId);
    const { n } = await this.db.selectFrom('trusted_contacts').select((eb) => eb.fn.countAll<number>().as('n')).where('user_id', '=', userId).where('deleted_at', 'is', null).executeTakeFirstOrThrow();
    const max = await this.setting('date_safety.max_trusted_contacts');
    if (Number(n) >= max) throw new AppError('LIMIT_REACHED', `Up to ${max} trusted contacts`, { limit: max });
    const c = await this.db.insertInto('trusted_contacts').values({
      user_id: userId, name: input.name, phone_e164_enc: input.phone ? this.enc.encrypt(input.phone) : null, email_enc: input.email ? this.enc.encrypt(input.email.toLowerCase()) : null, relationship: input.relationship ?? null,
    }).returning('id').executeTakeFirstOrThrow();
    await this.sendInvite(userId, c.id);
    return this.listContacts(userId);
  }

  /** Re-sends the confirmation request to a contact who hasn't confirmed yet (new token; the old link stops working). */
  async resendInvite(userId: string, contactId: string) {
    const c = await this.db.selectFrom('trusted_contacts').select(['consent_confirmed_at', 'confirm_expires_at']).where('id', '=', contactId).where('user_id', '=', userId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!c) throw new AppError('NOT_FOUND');
    if (c.consent_confirmed_at) throw new AppError('CONFLICT', 'This contact has already confirmed');
    // Throttled by an admin setting (the expiry of the previous token tells us when it was sent).
    const cooldown = await this.setting('date_safety.invite_resend_cooldown_min');
    if (c.confirm_expires_at && new Date(c.confirm_expires_at).getTime() > Date.now() + INVITE_TTL_MS - cooldown * 60_000) throw new AppError('RATE_LIMITED', 'Please wait before resending', { retryAfterMin: cooldown });
    await this.sendInvite(userId, contactId);
    return this.listContacts(userId);
  }

  private async sendInvite(userId: string, contactId: string) {
    const token = randomToken(24);
    const c = await this.db.updateTable('trusted_contacts').set({ confirm_token_hash: sha256(token), confirm_expires_at: new Date(Date.now() + INVITE_TTL_MS) }).where('id', '=', contactId)
      .returning(['phone_e164_enc', 'email_enc']).executeTakeFirstOrThrow();
    const u = await this.db.selectFrom('users as u').leftJoin('user_profiles as p', 'p.user_id', 'u.id').select(['p.display_name', 'u.locale']).where('u.id', '=', userId).executeTakeFirstOrThrow();
    const confirm = `${this.cfg.PUBLIC_WEB_URL.replace(/\/$/, '')}/trusted-contact/confirm?id=${contactId}&token=${token}`;
    const channel = c.phone_e164_enc ? 'sms' : 'email';
    // Trusted contacts require a completed profile (gate), so display_name is set in practice.
    const r = this.notifications.renderContent(await this.notifications.content('safety.trusted_contact_invite', u.locale, channel), { name: u.display_name ?? '', link: confirm });
    if (c.phone_e164_enc) await this.messaging.sendSms({ to: this.enc.decrypt(c.phone_e164_enc as Buffer), body: r.body });
    else await this.messaging.sendEmail({ to: this.enc.decrypt(c.email_enc as Buffer), subject: r.subject ?? '', text: r.body });
  }

  /** Public endpoint target: the contact confirms they agree to receive alerts. */
  async confirmContact(contactId: string, token: string) {
    const c = await this.db.selectFrom('trusted_contacts').select(['confirm_token_hash', 'confirm_expires_at']).where('id', '=', contactId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!c?.confirm_token_hash || !c.confirm_expires_at || new Date(c.confirm_expires_at) < new Date() || !sha256(token).equals(c.confirm_token_hash as Buffer)) throw new AppError('TOKEN_INVALID');
    await this.db.updateTable('trusted_contacts').set({ consent_confirmed_at: new Date(), confirm_token_hash: null, confirm_expires_at: null }).where('id', '=', contactId).execute();
  }

  async listContacts(userId: string) {
    const rows = await this.db.selectFrom('trusted_contacts').selectAll().where('user_id', '=', userId).where('deleted_at', 'is', null).orderBy('created_at').execute();
    return rows.map((r) => {
      const phone = r.phone_e164_enc ? this.enc.decrypt(r.phone_e164_enc as Buffer) : null;
      const email = r.email_enc ? this.enc.decrypt(r.email_enc as Buffer) : null;
      return { id: r.id, name: r.name, relationship: r.relationship, phoneMasked: phone ? `•••${phone.slice(-3)}` : null, emailMasked: email ? `${email[0]}•••@${email.split('@')[1]}` : null, confirmed: !!r.consent_confirmed_at };
    });
  }

  async removeContact(userId: string, id: string) {
    // Hard delete: contact details are personal data of a third party; sessions keep running with the link removed.
    const r = await this.db.deleteFrom('trusted_contacts').where('id', '=', id).where('user_id', '=', userId).executeTakeFirst();
    if (!r.numDeletedRows) throw new AppError('NOT_FOUND');
  }

  // ------------------------------------------------------------------------------------ sessions

  async start(userId: string, input: z.infer<typeof safetySessionStart>) {
    await this.gate(userId);
    if (input.datePlanId) {
      const p = await this.db.selectFrom('date_plan_participants').select('user_id').where('date_plan_id', '=', input.datePlanId).where('user_id', '=', userId).executeTakeFirst();
      if (!p) throw new AppError('NOT_FOUND');
    }
    if (input.trustedContactId) {
      const c = await this.db.selectFrom('trusted_contacts').select(['consent_confirmed_at']).where('id', '=', input.trustedContactId).where('user_id', '=', userId).where('deleted_at', 'is', null).executeTakeFirst();
      if (!c) throw new AppError('NOT_FOUND');
      if (!c.consent_confirmed_at) throw new AppError('CONFLICT', 'This trusted contact has not confirmed yet');
    }
    if (input.shareLiveLocation && !(await this.preciseLocationConsent(userId))) throw new AppError('CONSENT_REQUIRED', 'Live location needs precise-location consent', { consentType: 'precise_location' });
    // Same set as activeSession(): an escalated or SOS session is still open and must be resolved first.
    const active = await this.db.selectFrom('date_safety_sessions').select('id').where('user_id', '=', userId).where('status', 'in', ['scheduled', 'active', 'checked_in', 'overdue', 'escalated', 'sos']).executeTakeFirst();
    if (active) throw new AppError('CONFLICT', 'You already have an active safety session', { sessionId: active.id });
    const token = randomToken(24);
    const startsAt = new Date(input.startsAt);
    const s = await this.db.insertInto('date_safety_sessions').values({
      user_id: userId, date_plan_id: input.datePlanId ?? null, trusted_contact_id: input.trustedContactId ?? null, status: startsAt <= new Date() ? 'active' : 'scheduled',
      share_details: input.shareDetails, share_live_location: input.shareLiveLocation, share_token_hash: sha256(token), starts_at: startsAt,
      check_in_due_at: new Date(startsAt.getTime() + input.checkInAfterMin * 60_000), grace_minutes: input.graceMinutes,
    }).returning('id').executeTakeFirstOrThrow();
    await this.analytics.track('safety_session_started', { userId });
    return { ...(await this.session(userId, s.id)), shareLink: input.trustedContactId ? this.link(token) : null };
  }

  /** The member's current session (the app needs it after a restart). Wrapped so "none" is valid JSON. */
  async activeSession(userId: string) {
    const s = await this.db.selectFrom('date_safety_sessions').select('id').where('user_id', '=', userId).where('status', 'in', ['scheduled', 'active', 'checked_in', 'overdue', 'escalated', 'sos']).orderBy('created_at', 'desc').executeTakeFirst();
    return { session: s ? await this.session(userId, s.id) : null };
  }

  async session(userId: string, id: string) {
    const s = await this.db.selectFrom('date_safety_sessions').selectAll().where('id', '=', id).where('user_id', '=', userId).executeTakeFirst();
    if (!s) throw new AppError('NOT_FOUND');
    const country = await this.db.selectFrom('users as u').leftJoin('country_configs as cc', 'cc.country_code', 'u.country_code').select('cc.emergency_number').where('u.id', '=', userId).executeTakeFirstOrThrow();
    return {
      id: s.id, status: s.status, datePlanId: s.date_plan_id, trustedContactId: s.trusted_contact_id, startsAt: new Date(s.starts_at).toISOString(), checkInDueAt: new Date(s.check_in_due_at).toISOString(),
      graceMinutes: s.grace_minutes, shareLiveLocation: s.share_live_location, checkedInAt: s.checked_in_at ? new Date(s.checked_in_at).toISOString() : null, emergencyNumber: country.emergency_number,
    };
  }

  /** "I'm OK" — optionally extends the timer (e.g. the date is going well). */
  async checkIn(userId: string, id: string, extendMin?: number) {
    const s = await this.session(userId, id);
    if (!['scheduled', 'active', 'checked_in', 'overdue', 'escalated'].includes(s.status)) throw new AppError('CONFLICT', `Session is ${s.status}`);
    // Without an extension the original deadline stays, unless it has already passed: then a fresh window starts so the
    // session isn't flagged overdue again on the next sweep right after the member said they're OK.
    const original = new Date(s.checkInDueAt).getTime();
    const due = new Date(extendMin ? Date.now() + extendMin * 60_000 : original > Date.now() ? original : Date.now() + (await this.setting('date_safety.recheck_after_min')) * 60_000);
    await this.db.updateTable('date_safety_sessions').set({ status: 'checked_in', checked_in_at: new Date(), check_in_due_at: due, overdue_at: null }).where('id', '=', id).execute();
    if (s.status === 'escalated') await this.alertContact(userId, id, 'resolved');
    return this.session(userId, id);
  }

  async checkOut(userId: string, id: string) {
    const s = await this.session(userId, id);
    if (['ended', 'cancelled', 'checked_out'].includes(s.status)) throw new AppError('CONFLICT', `Session is ${s.status}`);
    await this.db.updateTable('date_safety_sessions').set({ status: 'checked_out', checked_out_at: new Date() }).where('id', '=', id).execute();
    await this.db.deleteFrom('date_safety_locations').where('session_id', '=', id).execute(); // live location no longer needed
    return this.session(userId, id);
  }

  async ping(userId: string, id: string, loc: { latitude: number; longitude: number; accuracyM?: number }) {
    const s = await this.db.selectFrom('date_safety_sessions').select(['status', 'share_live_location']).where('id', '=', id).where('user_id', '=', userId).executeTakeFirst();
    if (!s) throw new AppError('NOT_FOUND');
    if (!s.share_live_location) throw new AppError('CONFLICT', 'Live location sharing is off for this session');
    if (['ended', 'cancelled', 'checked_out'].includes(s.status)) throw new AppError('CONFLICT', 'Session ended');
    if (!(await this.preciseLocationConsent(userId))) throw new AppError('CONSENT_REQUIRED', 'Live location needs precise-location consent', { consentType: 'precise_location' });
    await this.db.insertInto('date_safety_locations').values({ session_id: id, latitude: loc.latitude, longitude: loc.longitude, accuracy_m: loc.accuracyM ?? null }).execute();
  }

  /** SOS: immediate alert to the trusted contact + critical T&S case. The app also offers the local emergency number. */
  async sos(userId: string, id: string, loc?: { latitude?: number; longitude?: number; accuracyM?: number }) {
    // Deliberately accepted in every state, including after check-out: an emergency is never refused on a technicality.
    const s = await this.session(userId, id);
    await this.db.updateTable('date_safety_sessions').set({ status: 'sos', sos_at: new Date() }).where('id', '=', id).execute();
    if (loc?.latitude !== undefined && loc.longitude !== undefined) await this.db.insertInto('date_safety_locations').values({ session_id: id, latitude: loc.latitude, longitude: loc.longitude, accuracy_m: loc.accuracyM ?? null }).execute();
    await this.escalate(userId, id, 'sos');
    await this.analytics.track('sos_triggered', { userId });
    return { ...s, status: 'sos', emergencyNumber: s.emergencyNumber };
  }

  private async preciseLocationConsent(userId: string): Promise<boolean> {
    const c = await this.db.selectFrom('consent_records').select('granted').where('user_id', '=', userId).where('consent_type', '=', 'precise_location').orderBy('created_at', 'desc').limit(1).executeTakeFirst();
    return !!c?.granted;
  }

  private async escalate(userId: string, sessionId: string, reason: 'sos' | 'overdue') {
    const s = await this.db.selectFrom('date_safety_sessions').select(['date_plan_id']).where('id', '=', sessionId).executeTakeFirstOrThrow();
    let subject: string | null = null;
    if (s.date_plan_id) subject = (await this.db.selectFrom('date_plan_participants').select('user_id').where('date_plan_id', '=', s.date_plan_id).where('user_id', '<>', userId).executeTakeFirst())?.user_id ?? null;
    await this.db.transaction().execute(async (trx) => {
      await trx.insertInto('safety_events').values({ user_id: userId, signal: reason === 'sos' ? 'sos' : 'date_overdue', source: 'date_safety', score: reason === 'sos' ? 1 : 0.7, ref_type: 'date_safety_session', ref_id: sessionId }).execute();
      const caseId = await this.moderation.openOrAttachCase(trx, subject ?? userId, 'offline_safety', 'critical', 'automated');
      await trx.insertInto('case_evidence').values({ case_id: caseId, kind: 'note_attachment', ref_id: sessionId, snapshot: JSON.stringify({ reason, user: userId, datePlanId: s.date_plan_id }) }).execute();
      await this.audit.record({ actorType: 'system', action: `date_safety.${reason}`, targetType: 'date_safety_session', targetId: sessionId }, trx);
    });
    await this.alertContact(userId, sessionId, 'alert');
  }

  private async alertContact(userId: string, sessionId: string, kind: 'alert' | 'resolved') {
    const s = await this.db.selectFrom('date_safety_sessions as s').leftJoin('trusted_contacts as c', 'c.id', 's.trusted_contact_id')
      .select(['c.phone_e164_enc', 'c.email_enc', 'c.consent_confirmed_at', 's.share_token_hash']).where('s.id', '=', sessionId).executeTakeFirstOrThrow();
    if (!s.consent_confirmed_at) return;
    const user = await this.db.selectFrom('users as u').leftJoin('user_profiles as p', 'p.user_id', 'u.id').leftJoin('country_configs as cc', 'cc.country_code', 'u.country_code')
      .select(['p.display_name', 'cc.emergency_number', 'u.locale']).where('u.id', '=', userId).executeTakeFirstOrThrow();
    // A fresh view token is minted for the alert (only hashes are stored).
    const token = randomToken(24);
    await this.db.updateTable('date_safety_sessions').set({ share_token_hash: sha256(token) }).where('id', '=', sessionId).execute();
    // Safety sessions require a completed profile, so display_name is set in practice.
    const vars = { name: user.display_name ?? '', link: this.link(token), emergency: user.emergency_number ?? '' };
    const template = kind === 'resolved' ? 'safety.trusted_contact_resolved' : 'safety.trusted_contact_alert';
    if (s.phone_e164_enc) {
      const c = this.notifications.renderContent(await this.notifications.content(template, user.locale, 'sms'), vars);
      await this.messaging.sendSms({ to: this.enc.decrypt(s.phone_e164_enc as Buffer), body: c.body });
    }
    if (s.email_enc) {
      const c = this.notifications.renderContent(await this.notifications.content(template, user.locale, 'email'), vars);
      await this.messaging.sendEmail({ to: this.enc.decrypt(s.email_enc as Buffer), subject: c.subject ?? '', text: c.body });
    }
  }

  /** Trusted-contact view (public, token-authenticated). Shows what the user chose to share; expires after the session. */
  async contactView(token: string) {
    const s = await this.db.selectFrom('date_safety_sessions').selectAll().where('share_token_hash', '=', sha256(token)).executeTakeFirst();
    if (!s) throw new AppError('NOT_FOUND');
    const ended = s.checked_out_at ?? (['ended', 'cancelled'].includes(s.status) ? new Date() : null);
    if (ended && Date.now() - new Date(ended).getTime() > SHARE_LINK_GRACE_MS) throw new AppError('NOT_FOUND');
    const [profile, plan, loc] = await Promise.all([
      this.db.selectFrom('user_profiles').select('display_name').where('user_id', '=', s.user_id).executeTakeFirst(),
      s.share_details && s.date_plan_id ? this.db.selectFrom('date_plans').select(['title', 'venue_name', 'venue_address', 'starts_at', 'expected_duration_min']).where('id', '=', s.date_plan_id).executeTakeFirst() : undefined,
      s.share_live_location ? this.db.selectFrom('date_safety_locations').select(['latitude', 'longitude', 'accuracy_m', 'captured_at']).where('session_id', '=', s.id).orderBy('captured_at', 'desc').limit(1).executeTakeFirst() : undefined,
    ]);
    return {
      name: profile?.display_name ?? null, status: s.status, checkInDueAt: new Date(s.check_in_due_at).toISOString(), lastCheckInAt: s.checked_in_at ? new Date(s.checked_in_at).toISOString() : null,
      date: plan ? { title: plan.title, venue: plan.venue_name, address: plan.venue_address, startsAt: new Date(plan.starts_at).toISOString(), expectedDurationMin: plan.expected_duration_min } : null,
      lastLocation: loc ? { latitude: loc.latitude, longitude: loc.longitude, accuracyM: loc.accuracy_m, at: new Date(loc.captured_at).toISOString() } : null,
    };
  }

  async overdueSweep(): Promise<void> {
    const now = Date.now();
    await this.db.updateTable('date_safety_sessions').set({ status: 'active' }).where('status', '=', 'scheduled').where('starts_at', '<=', new Date()).execute();
    const escalateAfter = await this.setting('date_safety.escalate_after_overdue_min');
    const due = await this.db.selectFrom('date_safety_sessions').select(['id', 'user_id', 'status', 'check_in_due_at', 'grace_minutes', 'overdue_at']).where('status', 'in', ['active', 'checked_in', 'overdue']).execute();
    for (const s of due) {
      const dueAt = new Date(s.check_in_due_at).getTime();
      if (s.status !== 'overdue' && now > dueAt) {
        await this.db.updateTable('date_safety_sessions').set({ status: 'overdue', overdue_at: new Date() }).where('id', '=', s.id).execute();
        await this.notifications.notify(s.user_id, 'safety.checkin_due', {}, { dedupeKey: `checkin-due:${s.id}:${dueAt}`, deepLinkVars: { sessionId: s.id } });
      } else if (s.status === 'overdue' && s.overdue_at && now > new Date(s.overdue_at).getTime() + Math.max(s.grace_minutes, escalateAfter) * 60_000) {
        await this.db.updateTable('date_safety_sessions').set({ status: 'escalated', escalated_at: new Date() }).where('id', '=', s.id).execute();
        await this.escalate(s.user_id, s.id, 'overdue');
      }
    }
  }
}
