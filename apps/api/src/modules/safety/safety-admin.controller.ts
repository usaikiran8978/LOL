import { Body, Controller, Get, Header, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  adminAppealDecision, adminCaseAction, adminCaseCreate, adminCaseNote, adminCaseQuery, adminCaseUpdate, adminMediaReview, adminUserAction, adminUserSearch,
  adminVerificationDecision, pageQuery,
} from '@amora/shared';
import type { Request, Response } from 'express';
import { sql } from 'kysely';
import { z } from 'zod';
import { APP_CONFIG, type AppConfig } from '../../common/config/config';
import { DATABASE, type Database } from '../../common/db/database';
import { AppError } from '../../common/errors/app-error';
import { decodeCursor, encodeCursor, iso, keysetPage } from '../../common/http/cursor';
import { clientContext } from '../../common/http/request-context';
import { ZodPipe } from '../../common/http/zod.pipe';
import { OBJECT_STORAGE, type ObjectStorage } from '../../common/storage/object-storage';
import { assertUserInScope } from '../admin/auth/country-scope';
import type { AdminContext } from '../admin/auth/admin-auth.service';
import { AdminGuard, CurrentAdmin, RequirePermissions } from '../admin/auth/admin.guard';
import { AuditService } from '../../common/audit/audit.service';
import { ProfileStateService } from '../profiles/profile-state.service';
import { ModerationService } from './moderation.service';
import { TextModerationService } from './text-moderation';
import { VerificationService } from './verification.service';

type B<T extends z.ZodType> = z.infer<T>;
const id = new ParseUUIDPipe();

/** Writes the admin's access to a user's data (TECH §16 "admin access logging"). */
async function logAccess(db: Database, admin: AdminContext, userId: string, resource: string, purpose: string, caseId?: string | null) {
  await db.insertInto('admin_data_access_logs').values({ admin_user_id: admin.adminId, user_id: userId, resource, purpose, case_id: caseId ?? null }).execute();
}

const assertInScope = assertUserInScope;

/** Lifting a ban needs the ban permission, whichever endpoint reverses it. */
function assertCanReverse(admin: AdminContext, action: string) {
  if (['ban', 'unban'].includes(action) && !admin.permissions.has('moderation.ban')) throw new AppError('FORBIDDEN', 'Missing permission', { missing: ['moderation.ban'] });
}

// ============================================================================================ moderation

@ApiTags('admin-moderation')
@Controller('admin/moderation')
@UseGuards(AdminGuard)
export class AdminModerationController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly moderation: ModerationService,
    private readonly audit: AuditService,
    private readonly textModeration: TextModerationService,
  ) {}

  /** Queue ordered by SLA breach risk: severity, priority, due date. */
  @Get('cases')
  @RequirePermissions('moderation.view')
  async cases(@CurrentAdmin() a: AdminContext, @Query(new ZodPipe(adminCaseQuery)) q: B<typeof adminCaseQuery>) {
    const c = decodeCursor<[string, string]>(q.cursor, 2);
    let qb = this.db
      .selectFrom('moderation_cases as c')
      .leftJoin('users as u', 'u.id', 'c.subject_user_id')
      .leftJoin('user_profiles as p', 'p.user_id', 'c.subject_user_id')
      .select([
        'c.id', 'c.subject_user_id', 'p.display_name', 'u.status as subject_status', 'u.country_code', 'c.category', 'c.severity', 'c.priority_score', 'c.status', 'c.source', 'c.assigned_to',
        'c.sla_due_at', 'c.opened_at', 'c.resolved_at',
        sql<number>`(SELECT count(*)::int FROM reports r WHERE r.case_id = c.id)`.as('report_count'),
        sql<boolean>`c.sla_due_at < now() AND c.status IN ('open','in_review','escalated')`.as('sla_breached'),
      ])
      .orderBy('c.sla_due_at')
      .orderBy('c.id')
      .limit(q.limit + 1);
    if (q.status) qb = qb.where('c.status', '=', q.status);
    else qb = qb.where('c.status', 'in', ['open', 'in_review', 'escalated']);
    if (q.severity) qb = qb.where('c.severity', '=', q.severity);
    if (q.category) qb = qb.where('c.category', '=', q.category);
    if (q.subjectUserId) qb = qb.where('c.subject_user_id', '=', q.subjectUserId);
    if (q.assignedTo === 'me') qb = qb.where('c.assigned_to', '=', a.adminId);
    else if (q.assignedTo === 'unassigned') qb = qb.where('c.assigned_to', 'is', null);
    else if (q.assignedTo) qb = qb.where('c.assigned_to', '=', q.assignedTo);
    if (a.countryScope) qb = qb.where('u.country_code', 'in', a.countryScope);
    if (c) qb = qb.where((eb) => eb.or([eb('c.sla_due_at', '>', new Date(c[0])), eb.and([eb('c.sla_due_at', '=', new Date(c[0])), eb('c.id', '>', c[1])])]));
    const rows = await qb.execute();
    const items = rows.slice(0, q.limit);
    return { items, nextCursor: rows.length > q.limit ? encodeCursor([new Date(items.at(-1)!.sla_due_at).toISOString(), items.at(-1)!.id]) : null };
  }

  @Get('cases/:id')
  @RequirePermissions('moderation.view')
  async case(@CurrentAdmin() a: AdminContext, @Param('id', id) caseId: string) {
    const c = await this.db.selectFrom('moderation_cases').selectAll().where('id', '=', caseId).executeTakeFirst();
    if (!c) throw new AppError('NOT_FOUND');
    if (c.subject_user_id) await assertInScope(this.db, a, c.subject_user_id);
    const canSeeMessages = a.permissions.has('moderation.view_messages');
    const [reports, evidence, notes, actions, events, priorCases, profile, appeals] = await Promise.all([
      this.db.selectFrom('reports as r').leftJoin('taxonomy_terms as t', 't.id', 'r.reason_term_id').select(['r.id', 'r.reporter_id', 'r.target_type', 'r.target_id', 't.key as reason', 'r.details', 'r.created_at']).where('r.case_id', '=', caseId).orderBy('r.created_at').execute(),
      this.db.selectFrom('case_evidence').selectAll().where('case_id', '=', caseId).orderBy('captured_at').execute(),
      this.db.selectFrom('case_notes as n').innerJoin('admin_users as au', 'au.id', 'n.author_id').select(['n.id', 'n.body', 'n.created_at', 'au.display_name as author']).where('n.case_id', '=', caseId).orderBy('n.created_at').execute(),
      this.db.selectFrom('moderation_actions').selectAll().where('subject_user_id', '=', c.subject_user_id ?? '00000000-0000-0000-0000-000000000000').orderBy('created_at', 'desc').limit(50).execute(),
      this.db.selectFrom('safety_events').select(['id', 'signal', 'source', 'score', 'ref_type', 'ref_id', 'details', 'created_at']).where('user_id', '=', c.subject_user_id ?? '00000000-0000-0000-0000-000000000000').orderBy('created_at', 'desc').limit(50).execute(),
      this.db.selectFrom('moderation_cases').select(['id', 'category', 'severity', 'status', 'opened_at']).where('subject_user_id', '=', c.subject_user_id ?? '00000000-0000-0000-0000-000000000000').where('id', '<>', caseId).orderBy('opened_at', 'desc').limit(20).execute(),
      c.subject_user_id ? this.db.selectFrom('user_profiles as p').innerJoin('users as u', 'u.id', 'p.user_id').select(['p.display_name', 'p.bio', 'p.verification_level', 'u.status', 'u.created_at', 'u.country_code']).where('p.user_id', '=', c.subject_user_id).executeTakeFirst() : undefined,
      this.db.selectFrom('appeals as ap').innerJoin('moderation_actions as ma', 'ma.id', 'ap.action_id').select(['ap.id', 'ap.status', 'ap.statement', 'ap.created_at', 'ma.action']).where('ma.subject_user_id', '=', c.subject_user_id ?? '00000000-0000-0000-0000-000000000000').execute(),
    ]);
    if (c.subject_user_id) await logAccess(this.db, a, c.subject_user_id, canSeeMessages ? 'messages' : 'profile', 'moderation_case_review', caseId);
    const ttl = this.cfg.MEDIA_DOWNLOAD_URL_TTL_SECONDS;
    return {
      ...c, profile, reports, notes, actions, safetyEvents: events, priorCases, appeals,
      evidence: await Promise.all(evidence.map(async (e) => ({
        ...e,
        // Message content needs an extra permission; other admins see that evidence exists but not its text.
        snapshot: e.kind === 'message' && !canSeeMessages ? { redacted: true } : e.snapshot,
        url: e.storage_key ? await this.storage.signedDownloadUrl(e.storage_key, ttl) : (e.snapshot as { storageKey?: string }).storageKey ? await this.storage.signedDownloadUrl((e.snapshot as { storageKey: string }).storageKey, ttl) : null,
      }))),
    };
  }

  @Post('cases')
  @RequirePermissions('moderation.action')
  async createCase(@CurrentAdmin() a: AdminContext, @Req() req: Request, @Body(new ZodPipe(adminCaseCreate)) b: B<typeof adminCaseCreate>) {
    await assertInScope(this.db, a, b.subjectUserId);
    return this.db.transaction().execute(async (trx) => {
      const caseId = await this.moderation.openOrAttachCase(trx, b.subjectUserId, b.category, b.severity, 'admin');
      if (b.note) await trx.insertInto('case_notes').values({ case_id: caseId, author_id: a.adminId, body: b.note }).execute();
      await this.audit.record({ actorType: 'admin', actorId: a.adminId, action: 'moderation.case_opened', targetType: 'moderation_case', targetId: caseId, client: clientContext(req) }, trx);
      return { caseId };
    });
  }

  @Put('cases/:id')
  @RequirePermissions('moderation.view')
  async updateCase(@CurrentAdmin() a: AdminContext, @Req() req: Request, @Param('id', id) caseId: string, @Body(new ZodPipe(adminCaseUpdate)) b: B<typeof adminCaseUpdate>) {
    const before = await this.db.selectFrom('moderation_cases').selectAll().where('id', '=', caseId).executeTakeFirst();
    if (!before) throw new AppError('NOT_FOUND');
    if (before.subject_user_id) await assertInScope(this.db, a, before.subject_user_id);
    if (b.assignTo !== undefined && !a.permissions.has('moderation.assign') && b.assignTo !== 'me') throw new AppError('FORBIDDEN', 'Missing permission', { missing: ['moderation.assign'] });
    if ((b.status === 'escalated') && !a.permissions.has('moderation.escalate')) throw new AppError('FORBIDDEN', 'Missing permission', { missing: ['moderation.escalate'] });
    const set: Record<string, unknown> = {};
    if (b.status) set.status = b.status;
    if (b.status && ['dismissed', 'closed'].includes(b.status)) { set.resolved_at = new Date(); set.resolution_key = b.resolutionKey ?? b.status; }
    if (b.severity) { set.severity = b.severity; set.sla_due_at = await this.moderation.slaFor(b.severity); }
    if (b.assignTo !== undefined) { set.assigned_to = b.assignTo === 'me' ? a.adminId : b.assignTo; set.assigned_at = new Date(); if (!b.status && before.status === 'open') set.status = 'in_review'; }
    return this.db.transaction().execute(async (trx) => {
      const row = await trx.updateTable('moderation_cases').set(set).where('id', '=', caseId).returningAll().executeTakeFirstOrThrow();
      if (b.status === 'dismissed') await trx.updateTable('reports').set({ status: 'dismissed' }).where('case_id', '=', caseId).execute();
      await this.audit.record({ actorType: 'admin', actorId: a.adminId, action: 'moderation.case_updated', targetType: 'moderation_case', targetId: caseId, before: { status: before.status, severity: before.severity, assigned_to: before.assigned_to }, after: set, client: clientContext(req) }, trx);
      return row;
    });
  }

  @Post('cases/:id/notes')
  @RequirePermissions('moderation.view')
  async note(@CurrentAdmin() a: AdminContext, @Param('id', id) caseId: string, @Body(new ZodPipe(adminCaseNote)) b: B<typeof adminCaseNote>) {
    const c = await this.db.selectFrom('moderation_cases').select('subject_user_id').where('id', '=', caseId).executeTakeFirst();
    if (!c) throw new AppError('NOT_FOUND');
    if (c.subject_user_id) await assertInScope(this.db, a, c.subject_user_id);
    return this.db.insertInto('case_notes').values({ case_id: caseId, author_id: a.adminId, body: b.body }).returningAll().executeTakeFirstOrThrow();
  }

  @Post('cases/:id/actions')
  @HttpCode(200)
  @RequirePermissions('moderation.action')
  async act(@CurrentAdmin() a: AdminContext, @Req() req: Request, @Param('id', id) caseId: string, @Body(new ZodPipe(adminCaseAction)) b: B<typeof adminCaseAction>) {
    const c = await this.db.selectFrom('moderation_cases').select(['subject_user_id']).where('id', '=', caseId).executeTakeFirst();
    if (!c?.subject_user_id) throw new AppError('NOT_FOUND');
    await assertInScope(this.db, a, c.subject_user_id);
    if (['ban', 'unban'].includes(b.action) && !a.permissions.has('moderation.ban')) throw new AppError('FORBIDDEN', 'Missing permission', { missing: ['moderation.ban'] });
    if (b.action === 'escalate' && !a.permissions.has('moderation.escalate')) throw new AppError('FORBIDDEN', 'Missing permission', { missing: ['moderation.escalate'] });
    return this.moderation.applyAction({ type: 'admin', id: a.adminId }, c.subject_user_id, b, caseId, clientContext(req));
  }

  @Post('actions/:id/reverse')
  @HttpCode(200)
  @RequirePermissions('moderation.action')
  async reverse(@CurrentAdmin() a: AdminContext, @Req() req: Request, @Param('id', id) actionId: string, @Body(new ZodPipe(z.object({ note: z.string().max(3000).optional() }))) b: { note?: string }) {
    const act = await this.db.selectFrom('moderation_actions').select(['subject_user_id', 'action']).where('id', '=', actionId).executeTakeFirst();
    if (!act) throw new AppError('NOT_FOUND');
    await assertInScope(this.db, a, act.subject_user_id);
    assertCanReverse(a, act.action);
    return { reversalActionId: await this.moderation.reverse({ type: 'admin', id: a.adminId }, actionId, b.note, clientContext(req)) };
  }

  /** Every report, newest first (cases show only their own). Reporter identity needs `users.view_pii`. */
  @Get('reports')
  @RequirePermissions('moderation.view')
  async reports(@CurrentAdmin() a: AdminContext, @Query(new ZodPipe(pageQuery.extend({ status: z.enum(['received', 'triaged', 'resolved', 'dismissed']).optional(), reasonKey: z.string().max(50).optional(), reportedUserId: z.uuid().optional() }))) q: { limit: number; cursor?: string; status?: string; reasonKey?: string; reportedUserId?: string }) {
    const c = decodeCursor<[string, string]>(q.cursor, 2);
    const rows = await this.db.selectFrom('reports as r').leftJoin('users as u', 'u.id', 'r.reported_user_id').leftJoin('taxonomy_terms as t', 't.id', 'r.reason_term_id')
      .select(['r.id', 'r.reporter_id', 'r.reported_user_id', 'r.target_type', 'r.target_id', 't.key as reason_key', 'r.details', 'r.case_id', 'r.status', 'r.created_at', 'u.country_code'])
      .$if(!!q.status, (qb) => qb.where('r.status', '=', q.status!)).$if(!!q.reasonKey, (qb) => qb.where('t.key', '=', q.reasonKey!)).$if(!!q.reportedUserId, (qb) => qb.where('r.reported_user_id', '=', q.reportedUserId!))
      .$if(!!a.countryScope, (qb) => qb.where('u.country_code', 'in', a.countryScope!))
      .$if(!!c, (qb) => qb.where((eb) => eb.or([eb('r.created_at', '<', new Date(c![0])), eb.and([eb('r.created_at', '=', new Date(c![0])), eb('r.id', '<', c![1])])])))
      .orderBy('r.created_at', 'desc').orderBy('r.id', 'desc').limit(q.limit + 1).execute();
    const page = keysetPage(rows, q.limit, (r) => [iso(r.created_at), r.id]);
    const pii = a.permissions.has('users.view_pii');
    return { ...page, items: page.items.map((r) => ({ ...r, reporter_id: pii ? r.reporter_id : null })) };
  }

  /** Highest automated risk scores (TECH §15 risk scoring), with their components, for proactive review. */
  @Get('risk-scores')
  @RequirePermissions('moderation.view')
  async riskScores(@CurrentAdmin() a: AdminContext, @Query(new ZodPipe(pageQuery.extend({ minScore: z.coerce.number().min(0).max(1).default(0.5) }))) q: { limit: number; cursor?: string; minScore: number }) {
    const c = decodeCursor<[number, string]>(q.cursor, 2);
    const rows = await this.db.selectFrom('user_risk_scores as r').innerJoin('users as u', 'u.id', 'r.user_id').leftJoin('user_profiles as p', 'p.user_id', 'r.user_id')
      .select(['r.user_id', 'p.display_name', 'u.status', 'u.country_code', 'r.score', 'r.components', 'r.computed_at'])
      .where('r.score', '>=', q.minScore).$if(!!a.countryScope, (qb) => qb.where('u.country_code', 'in', a.countryScope!))
      .$if(!!c, (qb) => qb.where((eb) => eb.or([eb('r.score', '<', c![0]), eb.and([eb('r.score', '=', c![0]), eb('r.user_id', '>', c![1])])])))
      .orderBy('r.score', 'desc').orderBy('r.user_id').limit(q.limit + 1).execute();
    return keysetPage(rows, q.limit, (r) => [Number(r.score), r.user_id]);
  }

  @Get('appeals')
  @RequirePermissions('moderation.appeals')
  async appeals(@CurrentAdmin() a: AdminContext, @Query(new ZodPipe(pageQuery.extend({ status: z.enum(['submitted', 'in_review', 'upheld', 'overturned', 'partially_overturned']).optional() }))) q: { limit: number; cursor?: string; status?: string }) {
    const c = decodeCursor<[string, string]>(q.cursor, 2);
    let qb = this.db.selectFrom('appeals as ap').innerJoin('moderation_actions as ma', 'ma.id', 'ap.action_id').innerJoin('users as u', 'u.id', 'ap.user_id')
      // actor_id lets the console disable appeals the viewer may not decide (different-reviewer rule).
      .select(['ap.id', 'ap.user_id', 'ap.statement', 'ap.status', 'ap.created_at', 'ma.action', 'ma.reason_key', 'ma.case_id', 'ma.actor_id']).orderBy('ap.created_at').orderBy('ap.id').limit(q.limit + 1);
    if (a.countryScope) qb = qb.where('u.country_code', 'in', a.countryScope);
    qb = q.status ? qb.where('ap.status', '=', q.status) : qb.where('ap.status', 'in', ['submitted', 'in_review']);
    if (c) qb = qb.where((eb) => eb.or([eb('ap.created_at', '>', new Date(c[0])), eb.and([eb('ap.created_at', '=', new Date(c[0])), eb('ap.id', '>', c[1])])]));
    return keysetPage(await qb.execute(), q.limit, (r) => [iso(r.created_at), r.id]);
  }

  @Post('appeals/:id/decision')
  @HttpCode(200)
  @RequirePermissions('moderation.appeals')
  async decideAppeal(@CurrentAdmin() a: AdminContext, @Req() req: Request, @Param('id', id) appealId: string, @Body(new ZodPipe(adminAppealDecision)) b: B<typeof adminAppealDecision>) {
    const ap = await this.db.selectFrom('appeals').selectAll().where('id', '=', appealId).executeTakeFirst();
    if (!ap) throw new AppError('NOT_FOUND');
    if (!['submitted', 'in_review'].includes(ap.status)) throw new AppError('CONFLICT', 'Appeal already decided');
    // A different reviewer from the one who took the action decides the appeal.
    await assertInScope(this.db, a, ap.user_id);
    const action = await this.db.selectFrom('moderation_actions').select(['actor_id', 'action']).where('id', '=', ap.action_id).executeTakeFirstOrThrow();
    if (action.actor_id === a.adminId) throw new AppError('FORBIDDEN', 'Appeals must be decided by a different reviewer');
    if (b.decision === 'overturned') assertCanReverse(a, action.action);
    if (b.decision === 'overturned') await this.moderation.reverse({ type: 'admin', id: a.adminId }, ap.action_id, b.note, clientContext(req));
    await this.db.updateTable('appeals').set({ status: b.decision, reviewer_id: a.adminId, decision_note: b.note ?? null, decided_at: new Date() }).where('id', '=', appealId).execute();
    await this.audit.record({ actorType: 'admin', actorId: a.adminId, action: `moderation.appeal_${b.decision}`, targetType: 'appeal', targetId: appealId, client: clientContext(req) });
    return { status: b.decision };
  }

  @Get('rules')
  @RequirePermissions('moderation.rules.manage')
  rules() {
    return this.db.selectFrom('moderation_rules').selectAll().orderBy('scope').orderBy('key').execute();
  }

  @Put('rules/:key')
  @RequirePermissions('moderation.rules.manage')
  async upsertRule(@CurrentAdmin() a: AdminContext, @Req() req: Request, @Param('key') key: string, @Body(new ZodPipe(z.object({
    ruleType: z.enum(['keyword', 'regex', 'classifier_threshold', 'velocity', 'auto_action', 'sla']),
    scope: z.enum(['message', 'profile_text', 'media', 'account', 'event', 'ai_output']),
    config: z.record(z.string(), z.unknown()),
    locale: z.string().max(10).nullable().default(null),
    isActive: z.boolean().default(true),
  }))) b: { ruleType: string; scope: string; config: Record<string, unknown>; locale: string | null; isActive: boolean }) {
    if (!/^[a-z0-9_]{2,64}$/.test(key)) throw new AppError('VALIDATION_FAILED', 'invalid key');
    if (b.ruleType === 'regex') {
      try { new RegExp(String(b.config.pattern), String(b.config.flags ?? 'iu')); } catch { throw new AppError('VALIDATION_FAILED', 'Invalid regular expression'); }
    }
    const before = await this.db.selectFrom('moderation_rules').selectAll().where('key', '=', key).executeTakeFirst();
    const row = await this.db.transaction().execute(async (trx) => {
      const v = { rule_type: b.ruleType, scope: b.scope, config: JSON.stringify(b.config), locale: b.locale, is_active: b.isActive, updated_by: a.adminId, version: (before?.version ?? 0) + 1 };
      const r = await trx.insertInto('moderation_rules').values({ key, ...v }).onConflict((oc) => oc.column('key').doUpdateSet(v)).returningAll().executeTakeFirstOrThrow();
      await this.audit.record({ actorType: 'admin', actorId: a.adminId, action: 'moderation.rule_upserted', targetType: 'moderation_rule', targetId: key, before: before ?? null, after: b, client: clientContext(req) }, trx);
      return r;
    });
    this.textModeration.invalidate();
    return row;
  }
}

// ============================================================================================ verification & profile review

@ApiTags('admin-verification')
@Controller('admin')
@UseGuards(AdminGuard)
export class AdminReviewController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly verification: VerificationService,
    private readonly moderation: ModerationService,
    private readonly profileState: ProfileStateService,
    private readonly audit: AuditService,
  ) {}

  @Get('verification/queue')
  @RequirePermissions('verification.view')
  async queue(@CurrentAdmin() a: AdminContext, @Query(new ZodPipe(pageQuery)) q: B<typeof pageQuery>) {
    const c = decodeCursor<[string, string]>(q.cursor, 2);
    const rows = await this.db.selectFrom('verification_requests as v').leftJoin('user_profiles as p', 'p.user_id', 'v.user_id').innerJoin('users as u', 'u.id', 'v.user_id')
      .select(['v.id', 'v.user_id', 'p.display_name', 'v.kind', 'v.status', 'v.provider', 'v.pose_challenge', 'v.submitted_at'])
      .where('v.status', 'in', ['needs_review', 'processing']).where('v.submitted_at', 'is not', null).$if(!!a.countryScope, (qb) => qb.where('u.country_code', 'in', a.countryScope!))
      .$if(!!c, (qb) => qb.where((eb) => eb.or([eb('v.submitted_at', '>', new Date(c![0])), eb.and([eb('v.submitted_at', '=', new Date(c![0])), eb('v.id', '>', c![1])])])))
      .orderBy('v.submitted_at').orderBy('v.id').limit(q.limit + 1).execute();
    return keysetPage(rows, q.limit, (r) => [iso(r.submitted_at!), r.id]);
  }

  /** Evidence images are only signed for admins with `verification.view_evidence`; access is logged. */
  @Get('verification/:id')
  @RequirePermissions('verification.view')
  async request(@CurrentAdmin() a: AdminContext, @Param('id', id) rid: string) {
    const r = await this.db.selectFrom('verification_requests').selectAll().where('id', '=', rid).executeTakeFirst();
    if (!r) throw new AppError('NOT_FOUND');
    await assertInScope(this.db, a, r.user_id);
    const canSee = a.permissions.has('verification.view_evidence');
    const photos = await this.db.selectFrom('profile_media').select(['id', 'storage_key']).where('user_id', '=', r.user_id).where('kind', '=', 'photo').where('deleted_at', 'is', null).orderBy('position').limit(6).execute();
    if (canSee) await logAccess(this.db, a, r.user_id, 'verification_evidence', 'verification_review');
    const ttl = Math.min(300, this.cfg.MEDIA_DOWNLOAD_URL_TTL_SECONDS); // short-lived links for biometric data
    return {
      ...r,
      evidence: canSee ? await Promise.all(r.evidence_keys.map((k) => this.storage.signedDownloadUrl(k, ttl))) : null,
      profilePhotos: await Promise.all(photos.map(async (p) => ({ id: p.id, url: await this.storage.signedDownloadUrl(p.storage_key, ttl) }))),
    };
  }

  @Post('verification/:id/decision')
  @HttpCode(204)
  @RequirePermissions('verification.decide')
  async decide(@CurrentAdmin() a: AdminContext, @Req() req: Request, @Param('id', id) rid: string, @Body(new ZodPipe(adminVerificationDecision)) b: B<typeof adminVerificationDecision>) {
    const r = await this.db.selectFrom('verification_requests').select('user_id').where('id', '=', rid).executeTakeFirst();
    if (!r) throw new AppError('NOT_FOUND');
    await assertInScope(this.db, a, r.user_id);
    await this.verification.complete(rid, b.decision, { type: 'admin', id: a.adminId }, b.rejectionReasonKey, clientContext(req));
  }

  /** Profile review queue: media awaiting review and flagged profile text. */
  @Get('profile-review/queue')
  @RequirePermissions('profiles.review')
  async reviewQueue(@CurrentAdmin() a: AdminContext, @Query(new ZodPipe(pageQuery)) q: B<typeof pageQuery>) {
    const scope = a.countryScope;
    const inScope = scope ? this.db.selectFrom('users').select('id').where('country_code', 'in', scope) : null;
    const ttl = this.cfg.MEDIA_DOWNLOAD_URL_TTL_SECONDS;
    const [media, prompts, profiles] = await Promise.all([
      this.db.selectFrom('profile_media').select(['id', 'user_id', 'kind', 'storage_key', 'moderation_status', 'created_at']).where('moderation_status', 'in', ['pending', 'needs_review']).where('processing_status', '=', 'ready')
        .where('deleted_at', 'is', null).$if(!!inScope, (qb) => qb.where('user_id', 'in', inScope!)).orderBy('created_at').limit(q.limit).execute(),
      this.db.selectFrom('profile_prompts').select(['id', 'user_id', 'answer', 'created_at']).where('moderation_status', '=', 'pending').$if(!!inScope, (qb) => qb.where('user_id', 'in', inScope!)).orderBy('created_at').limit(q.limit).execute(),
      this.db.selectFrom('user_profiles').select(['user_id', 'display_name', 'bio', 'updated_at']).where('moderation_status', '=', 'needs_changes').$if(!!inScope, (qb) => qb.where('user_id', 'in', inScope!)).orderBy('updated_at').limit(q.limit).execute(),
    ]);
    return { media: await Promise.all(media.map(async (m) => ({ ...m, storage_key: undefined, url: await this.storage.signedDownloadUrl(m.storage_key, ttl) }))), prompts, profiles };
  }

  @Post('profile-review/media/:id')
  @HttpCode(204)
  @RequirePermissions('profiles.review')
  async reviewMedia(@CurrentAdmin() a: AdminContext, @Req() req: Request, @Param('id', id) mid: string, @Body(new ZodPipe(adminMediaReview)) b: B<typeof adminMediaReview>) {
    const m = await this.db.selectFrom('profile_media').select(['user_id']).where('id', '=', mid).executeTakeFirst();
    if (!m) throw new AppError('NOT_FOUND');
    await assertInScope(this.db, a, m.user_id);
    await this.db.transaction().execute(async (trx) => {
      await trx.updateTable('profile_media').set({ moderation_status: b.decision }).where('id', '=', mid).execute();
      await this.audit.record({ actorType: 'admin', actorId: a.adminId, action: `profiles.media_${b.decision}`, targetType: 'profile_media', targetId: mid, after: { reason: b.reasonKey ?? null }, client: clientContext(req) }, trx);
    });
    await this.profileState.recompute(m.user_id);
  }

  @Post('profile-review/prompts/:id')
  @HttpCode(204)
  @RequirePermissions('profiles.review')
  async reviewPrompt(@CurrentAdmin() a: AdminContext, @Req() req: Request, @Param('id', id) pid: string, @Body(new ZodPipe(adminMediaReview)) b: B<typeof adminMediaReview>) {
    const p = await this.db.selectFrom('profile_prompts').select('user_id').where('id', '=', pid).executeTakeFirst();
    if (!p) throw new AppError('NOT_FOUND');
    await assertInScope(this.db, a, p.user_id);
    await this.db.transaction().execute(async (trx) => {
      await trx.updateTable('profile_prompts').set({ moderation_status: b.decision }).where('id', '=', pid).execute();
      await this.audit.record({ actorType: 'admin', actorId: a.adminId, action: `profiles.prompt_${b.decision}`, targetType: 'profile_prompt', targetId: pid, client: clientContext(req) }, trx);
    });
    await this.profileState.recompute(p.user_id);
  }

  @Post('profile-review/profiles/:userId')
  @HttpCode(204)
  @RequirePermissions('profiles.review')
  async reviewProfile(@CurrentAdmin() a: AdminContext, @Req() req: Request, @Param('userId', id) uid: string, @Body(new ZodPipe(adminMediaReview)) b: B<typeof adminMediaReview>) {
    await assertInScope(this.db, a, uid);
    await this.db.transaction().execute(async (trx) => {
      await trx.updateTable('user_profiles').set({ moderation_status: b.decision === 'approved' ? 'approved' : 'rejected' }).where('user_id', '=', uid).execute();
      await this.audit.record({ actorType: 'admin', actorId: a.adminId, action: `profiles.profile_${b.decision}`, targetType: 'user', targetId: uid, client: clientContext(req) }, trx);
    });
    await this.profileState.recompute(uid);
  }
}

// ============================================================================================ user management

@ApiTags('admin-users')
@Controller('admin/users')
@UseGuards(AdminGuard)
export class AdminUsersController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly moderation: ModerationService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions('users.view')
  async search(@CurrentAdmin() a: AdminContext, @Query(new ZodPipe(adminUserSearch)) q: B<typeof adminUserSearch>) {
    const c = decodeCursor<[string, string]>(q.cursor, 2);
    const pii = a.permissions.has('users.view_pii');
    let qb = this.db.selectFrom('users as u').leftJoin('user_profiles as p', 'p.user_id', 'u.id')
      .select(['u.id', 'u.email', 'u.phone_e164', 'u.status', 'u.country_code', 'u.created_at', 'u.last_active_at', 'p.display_name', 'p.verification_level', 'p.is_discoverable'])
      .orderBy('u.created_at', 'desc').orderBy('u.id', 'desc').limit(q.limit + 1);
    if (q.q) {
      const term = q.q.trim();
      if (/^[0-9a-f-]{36}$/i.test(term)) qb = qb.where('u.id', '=', term);
      else if (pii && term.includes('@')) qb = qb.where('u.email', '=', term.toLowerCase());
      else if (pii && /^\+\d{7,15}$/.test(term)) qb = qb.where('u.phone_e164', '=', term);
      else qb = qb.where('p.display_name', 'ilike', `${term.replace(/[%_\\]/g, (x) => `\\${x}`)}%`);
    }
    if (q.status) qb = qb.where('u.status', '=', q.status);
    if (q.country) qb = qb.where('u.country_code', '=', q.country);
    if (q.verified !== undefined) qb = q.verified ? qb.where('p.verification_level', 'in', ['selfie', 'identity']) : qb.where((eb) => eb.or([eb('p.verification_level', 'is', null), eb('p.verification_level', 'not in', ['selfie', 'identity'])]));
    if (a.countryScope) qb = qb.where('u.country_code', 'in', a.countryScope);
    if (c) qb = qb.where((eb) => eb.or([eb('u.created_at', '<', new Date(c[0])), eb.and([eb('u.created_at', '=', new Date(c[0])), eb('u.id', '<', c[1])])]));
    const rows = await qb.execute();
    const items = rows.slice(0, q.limit).map((r) => ({ ...r, email: pii ? r.email : r.email ? mask(r.email) : null, phone_e164: pii ? r.phone_e164 : r.phone_e164 ? `•••${r.phone_e164.slice(-3)}` : null }));
    return { items, nextCursor: rows.length > q.limit ? encodeCursor([new Date(items.at(-1)!.created_at).toISOString(), items.at(-1)!.id]) : null };
  }

  @Get(':id')
  @RequirePermissions('users.view')
  async detail(@CurrentAdmin() a: AdminContext, @Param('id', id) uid: string) {
    await assertInScope(this.db, a, uid);
    const pii = a.permissions.has('users.view_pii');
    const u = await this.db.selectFrom('users').select(['id', 'email', 'phone_e164', 'status', 'status_reason', 'status_until', 'country_code', 'locale', 'created_at', 'last_login_at', 'last_active_at', 'email_verified_at', 'phone_verified_at', 'failed_login_count', 'locked_until', 'date_of_birth'])
      .where('id', '=', uid).executeTakeFirst();
    if (!u) throw new AppError('NOT_FOUND');
    const [profile, sessions, restrictions, verification, reportsAgainst, reportsBy, matches] = await Promise.all([
      this.db.selectFrom('user_profiles').selectAll().where('user_id', '=', uid).executeTakeFirst(),
      this.db.selectFrom('user_sessions as s').leftJoin('user_devices as d', 'd.id', 's.device_id').select(['s.id', 's.created_at', 's.last_used_at', 'd.platform', 'd.model', 'd.app_version']).where('s.user_id', '=', uid).where('s.revoked_at', 'is', null).execute(),
      this.db.selectFrom('account_restrictions').selectAll().where('user_id', '=', uid).where('lifted_at', 'is', null).execute(),
      this.db.selectFrom('verification_requests').select(['id', 'kind', 'status', 'submitted_at', 'decided_at', 'expires_at']).where('user_id', '=', uid).orderBy('submitted_at', 'desc').limit(10).execute(),
      this.db.selectFrom('reports').select(sql<number>`count(*)::int`.as('n')).where('reported_user_id', '=', uid).executeTakeFirstOrThrow(),
      this.db.selectFrom('reports').select(sql<number>`count(*)::int`.as('n')).where('reporter_id', '=', uid).executeTakeFirstOrThrow(),
      this.db.selectFrom('matches').select(sql<number>`count(*)::int`.as('n')).where((eb) => eb.or([eb('user_low_id', '=', uid), eb('user_high_id', '=', uid)])).executeTakeFirstOrThrow(),
    ]);
    if (pii) await logAccess(this.db, a, uid, 'profile', 'user_detail');
    const safety = a.permissions.has('users.view_safety_history')
      ? {
          cases: await this.db.selectFrom('moderation_cases').select(['id', 'category', 'severity', 'status', 'opened_at']).where('subject_user_id', '=', uid).orderBy('opened_at', 'desc').limit(20).execute(),
          actions: await this.db.selectFrom('moderation_actions').select(['id', 'action', 'reason_key', 'created_at', 'reversed_at']).where('subject_user_id', '=', uid).orderBy('created_at', 'desc').limit(20).execute(),
          riskScore: (await this.db.selectFrom('user_risk_scores').select(['score', 'components', 'computed_at']).where('user_id', '=', uid).executeTakeFirst()) ?? null,
        }
      : null;
    return {
      ...u, email: pii ? u.email : u.email ? mask(u.email) : null, phone_e164: pii ? u.phone_e164 : u.phone_e164 ? `•••${u.phone_e164.slice(-3)}` : null, date_of_birth: pii ? u.date_of_birth : null,
      profile, sessions, restrictions, verification, counts: { reportsAgainst: reportsAgainst.n, reportsBy: reportsBy.n, matches: matches.n }, safety,
    };
  }

  /** Precise location is only for incident investigations; the purpose is mandatory and logged. */
  @Get(':id/location')
  @RequirePermissions('users.view_location')
  async location(@CurrentAdmin() a: AdminContext, @Req() req: Request, @Param('id', id) uid: string, @Query('caseId') caseId?: string) {
    if (!caseId || !/^[0-9a-f-]{36}$/i.test(caseId)) throw new AppError('VALIDATION_FAILED', 'caseId is required to view precise location');
    await assertInScope(this.db, a, uid);
    // The justification must be a real, open case about this user (or one they reported).
    const kase = await this.db.selectFrom('moderation_cases as c').select('c.id').where('c.id', '=', caseId).where('c.status', 'not in', ['closed', 'dismissed'])
      .where((eb) => eb.or([eb('c.subject_user_id', '=', uid), eb.exists(eb.selectFrom('reports as r').select('r.id').whereRef('r.case_id', '=', 'c.id').where('r.reporter_id', '=', uid))])).executeTakeFirst();
    if (!kase) throw new AppError('VALIDATION_FAILED', 'caseId must reference an open case concerning this user');
    await logAccess(this.db, a, uid, 'location', 'incident_investigation', caseId);
    await this.audit.record({ actorType: 'admin', actorId: a.adminId, action: 'users.location_viewed', targetType: 'user', targetId: uid, after: { caseId }, client: clientContext(req) });
    return (await this.db.selectFrom('user_locations').selectAll().where('user_id', '=', uid).executeTakeFirst()) ?? null;
  }

  @Post(':id/actions')
  @HttpCode(200)
  @RequirePermissions('users.view')
  async action(@CurrentAdmin() a: AdminContext, @Req() req: Request, @Param('id', id) uid: string, @Body(new ZodPipe(adminUserAction)) b: B<typeof adminUserAction>) {
    await assertInScope(this.db, a, uid);
    const needed = {
      suspend: 'users.suspend', unsuspend: 'users.suspend', ban: 'users.ban', unban: 'users.ban', restore: 'users.restore', force_logout: 'users.force_logout',
      reset_lockout: 'users.reset_controls', verify: 'verification.decide', unverify: 'verification.revoke',
    }[b.action] as Parameters<AdminContext['permissions']['has']>[0];
    if (!a.permissions.has(needed)) throw new AppError('FORBIDDEN', 'Missing permission', { missing: [needed] });
    if (b.action === 'reset_lockout') {
      await this.db.transaction().execute(async (trx) => {
        await trx.updateTable('users').set({ failed_login_count: 0, locked_until: null }).where('id', '=', uid).execute();
        await this.audit.record({ actorType: 'admin', actorId: a.adminId, action: 'users.lockout_reset', targetType: 'user', targetId: uid, reason: b.note, client: clientContext(req) }, trx);
      });
      return { ok: true };
    }
    if (b.action === 'restore') {
      await this.db.transaction().execute(async (trx) => {
        await trx.updateTable('users').set({ status: 'active', deleted_at: null, status_reason: null }).where('id', '=', uid).where('status', '=', 'deactivated').execute();
        await this.audit.record({ actorType: 'admin', actorId: a.adminId, action: 'users.restored', targetType: 'user', targetId: uid, reason: b.note, client: clientContext(req) }, trx);
      });
      return { ok: true };
    }
    if (b.action === 'suspend' && !b.durationHours) throw new AppError('VALIDATION_FAILED', 'durationHours required');
    return this.moderation.applyAction({ type: 'admin', id: a.adminId }, uid, { action: b.action, reasonKey: b.reasonKey, note: b.note, durationHours: b.durationHours }, null, clientContext(req));
  }

  /** CSV export of a search (no PII unless permitted). Audited. */
  @Get('export/csv')
  @RequirePermissions('users.export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async export(@CurrentAdmin() a: AdminContext, @Req() req: Request, @Res() res: Response, @Query(new ZodPipe(adminUserSearch)) q: B<typeof adminUserSearch>) {
    const pii = a.permissions.has('users.view_pii');
    await this.audit.record({ actorType: 'admin', actorId: a.adminId, action: 'users.exported', after: { filters: q, pii }, client: clientContext(req) });
    res.setHeader('Content-Disposition', 'attachment; filename="users.csv"');
    res.write('id,status,country,created_at,verification,email\n');
    let cursor: string | undefined;
    // Streamed page by page — never the whole table in memory.
    for (let pages = 0; pages < 1000; pages++) {
      const page = await this.search(a, { ...q, cursor, limit: 100 });
      for (const r of page.items) res.write([r.id, r.status, r.country_code ?? '', new Date(r.created_at).toISOString(), r.verification_level ?? '', pii ? csv(r.email ?? '') : ''].join(',') + '\n');
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    res.end();
  }
}

function mask(email: string): string {
  const [l, d] = email.split('@');
  return `${l!.slice(0, 1)}•••@${d}`;
}

function csv(v: string): string {
  // Neutralize spreadsheet formula injection and quote.
  const safe = /^[=+\-@]/.test(v) ? `'${v}` : v;
  return `"${safe.replace(/"/g, '""')}"`;
}
