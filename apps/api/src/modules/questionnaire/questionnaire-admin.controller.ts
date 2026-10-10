import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  adminCompatibilityCategoryUpsert, adminDealBreakerUpsert, adminPreviewRequest, adminPublishRequest, adminQuestionCategoryUpsert, adminQuestionCreate,
  adminQuestionMeta, adminQuestionOrder, adminVersionInput,
} from '@amora/shared';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../../common/audit/audit.service';
import { DATABASE, type Database } from '../../common/db/database';
import { AppError } from '../../common/errors/app-error';
import { clientContext } from '../../common/http/request-context';
import { ZodPipe } from '../../common/http/zod.pipe';
import type { AdminContext } from '../admin/auth/admin-auth.service';
import { AdminGuard, CurrentAdmin, RequirePermissions } from '../admin/auth/admin.guard';
import { AuditedController, uniqueViolation } from '../admin/common/audited';
import { QuestionnaireAdminService } from './questionnaire-admin.service';

type B<T extends z.ZodType> = z.infer<T>;
const id = new ParseUUIDPipe();
const listQuery = z.object({ categoryId: z.uuid().optional(), status: z.enum(['active', 'inactive', 'archived', 'draft_only']).optional() });

@ApiTags('admin-questionnaire')
@Controller('admin/questions')
@UseGuards(AdminGuard)
export class AdminQuestionsController {
  constructor(private readonly svc: QuestionnaireAdminService) {}

  @Get()
  @RequirePermissions('questions.view')
  list(@Query(new ZodPipe(listQuery)) q: B<typeof listQuery>) {
    return this.svc.list(q);
  }

  @Get(':id')
  @RequirePermissions('questions.view')
  get(@Param('id', id) qid: string) {
    return this.svc.get(qid);
  }

  @Post()
  @RequirePermissions('questions.edit')
  create(@CurrentAdmin() a: AdminContext, @Req() req: Request, @Body(new ZodPipe(adminQuestionCreate)) body: B<typeof adminQuestionCreate>) {
    return this.svc.create(a, clientContext(req), body);
  }

  @Put(':id')
  @RequirePermissions('questions.edit')
  meta(@CurrentAdmin() a: AdminContext, @Req() req: Request, @Param('id', id) qid: string, @Body(new ZodPipe(adminQuestionMeta)) body: B<typeof adminQuestionMeta>) {
    return this.svc.updateMeta(a, clientContext(req), qid, body);
  }

  @Put('order/:categoryId')
  @HttpCode(204)
  @RequirePermissions('questions.edit')
  async reorder(@CurrentAdmin() a: AdminContext, @Req() req: Request, @Param('categoryId', id) categoryId: string, @Body(new ZodPipe(adminQuestionOrder)) body: B<typeof adminQuestionOrder>) {
    if (body.categoryId !== categoryId) throw new AppError('VALIDATION_FAILED', 'categoryId mismatch');
    await this.svc.reorder(a, clientContext(req), categoryId, body.questionIds);
  }

  @Post(':id/drafts')
  @RequirePermissions('questions.edit')
  draft(@CurrentAdmin() a: AdminContext, @Req() req: Request, @Param('id', id) qid: string, @Body() raw: unknown) {
    // Empty body = copy the latest version; otherwise the body is the full draft content.
    const empty = !raw || (typeof raw === 'object' && Object.keys(raw as object).length === 0);
    return this.svc.createDraft(a, clientContext(req), qid, empty ? undefined : new ZodPipe(adminVersionInput).transform(raw));
  }

  @Put('versions/:versionId')
  @RequirePermissions('questions.edit')
  updateDraft(@CurrentAdmin() a: AdminContext, @Req() req: Request, @Param('versionId', id) vid: string, @Body(new ZodPipe(adminVersionInput)) body: B<typeof adminVersionInput>) {
    return this.svc.updateDraft(a, clientContext(req), vid, body);
  }

  @Delete('versions/:versionId')
  @HttpCode(204)
  @RequirePermissions('questions.edit')
  async deleteDraft(@CurrentAdmin() a: AdminContext, @Req() req: Request, @Param('versionId', id) vid: string) {
    await this.svc.deleteDraft(a, clientContext(req), vid);
  }

  @Get('versions/:versionId/validate')
  @RequirePermissions('questions.view')
  async validate(@Param('versionId', id) vid: string) {
    return { issues: await this.svc.validate(vid) };
  }

  @Post('versions/:versionId/preview')
  @HttpCode(200)
  @RequirePermissions('questions.view')
  preview(@Param('versionId', id) vid: string, @Body(new ZodPipe(adminPreviewRequest)) body: B<typeof adminPreviewRequest>) {
    return this.svc.preview(vid, body.locale, body.facts);
  }

  @Get('versions/:versionId/impact')
  @RequirePermissions('questions.view')
  impact(@Param('versionId', id) vid: string) {
    return this.svc.impact(vid);
  }

  @Post('versions/:versionId/publish')
  @HttpCode(200)
  @RequirePermissions('questions.publish')
  publish(@CurrentAdmin() a: AdminContext, @Req() req: Request, @Param('versionId', id) vid: string, @Body(new ZodPipe(adminPublishRequest)) body: B<typeof adminPublishRequest>) {
    return this.svc.publish(a, clientContext(req), vid, body.effectiveAt, body.acknowledgeImpact);
  }

  @Post('versions/:versionId/cancel-schedule')
  @HttpCode(204)
  @RequirePermissions('questions.publish')
  async cancel(@CurrentAdmin() a: AdminContext, @Req() req: Request, @Param('versionId', id) vid: string) {
    await this.svc.cancelSchedule(a, clientContext(req), vid);
  }

  @Post(':id/rollback/:versionId')
  @HttpCode(200)
  @RequirePermissions('questions.publish')
  rollback(@CurrentAdmin() a: AdminContext, @Req() req: Request, @Param('id', id) qid: string, @Param('versionId', id) vid: string) {
    return this.svc.rollback(a, clientContext(req), qid, vid);
  }

  @Post(':id/activate')
  @HttpCode(204)
  @RequirePermissions('questions.archive')
  async activate(@CurrentAdmin() a: AdminContext, @Req() req: Request, @Param('id', id) qid: string) {
    await this.svc.setActive(a, clientContext(req), qid, true);
  }

  @Post(':id/deactivate')
  @HttpCode(204)
  @RequirePermissions('questions.archive')
  async deactivate(@CurrentAdmin() a: AdminContext, @Req() req: Request, @Param('id', id) qid: string) {
    await this.svc.setActive(a, clientContext(req), qid, false);
  }

  @Post(':id/archive')
  @HttpCode(204)
  @RequirePermissions('questions.archive')
  async archive(@CurrentAdmin() a: AdminContext, @Req() req: Request, @Param('id', id) qid: string) {
    await this.svc.archive(a, clientContext(req), qid);
  }

  @Get(':id/analytics')
  @RequirePermissions('questions.view')
  analytics(@Param('id', id) qid: string) {
    return this.svc.analytics(qid);
  }
}

/** Question categories, compatibility categories and deal-breaker definitions. */
@ApiTags('admin-questionnaire')
@Controller('admin/questionnaire')
@UseGuards(AdminGuard)
export class AdminQuestionnaireTaxonomyController extends AuditedController {
  constructor(@Inject(DATABASE) db: Database, audit: AuditService) {
    super(db, audit);
  }

  @Get('categories')
  @RequirePermissions('questions.view')
  async categories() {
    const rows = await this.db.selectFrom('question_categories').selectAll().orderBy('position').execute();
    const tr = await this.db.selectFrom('question_category_translations').selectAll().execute();
    return rows.map((r) => ({ ...r, translations: Object.fromEntries(tr.filter((t) => t.category_id === r.id).map((t) => [t.locale, { label: t.label, description: t.description }])) }));
  }

  @Put('categories/:key')
  @RequirePermissions('questions.edit')
  async upsertCategory(@CurrentAdmin() a: AdminContext, @Req() req: Request, @Param('key') key: string, @Body(new ZodPipe(adminQuestionCategoryUpsert)) body: B<typeof adminQuestionCategoryUpsert>) {
    if (key !== body.key) throw new AppError('VALIDATION_FAILED', 'key mismatch');
    const before = await this.db.selectFrom('question_categories').selectAll().where('key', '=', key).executeTakeFirst();
    return this.write(a, req, 'questions.category_upserted', { type: 'question_category', id: key }, before ?? null, async (trx) => {
      const v = { compatibility_category_id: body.compatibilityCategoryId, position: body.position, is_active: body.isActive };
      const row = await trx.insertInto('question_categories').values({ key, ...v }).onConflict((oc) => oc.column('key').doUpdateSet(v)).returningAll().executeTakeFirstOrThrow();
      await trx.deleteFrom('question_category_translations').where('category_id', '=', row.id).execute();
      await trx.insertInto('question_category_translations').values(Object.entries(body.translations).map(([locale, t]) => ({ category_id: row.id, locale, label: t.label, description: t.description ?? null }))).execute();
      return row;
    });
  }

  @Get('compatibility-categories')
  @RequirePermissions('matching.view')
  async compatCategories() {
    const rows = await this.db.selectFrom('compatibility_categories').selectAll().orderBy('position').execute();
    const tr = await this.db.selectFrom('compatibility_category_translations').selectAll().execute();
    return rows.map((r) => ({ ...r, translations: Object.fromEntries(tr.filter((t) => t.category_id === r.id).map((t) => [t.locale, { label: t.label, description: t.description }])) }));
  }

  @Put('compatibility-categories/:key')
  @RequirePermissions('matching.edit')
  async upsertCompat(@CurrentAdmin() a: AdminContext, @Req() req: Request, @Param('key') key: string, @Body(new ZodPipe(adminCompatibilityCategoryUpsert)) body: B<typeof adminCompatibilityCategoryUpsert>) {
    if (key !== body.key) throw new AppError('VALIDATION_FAILED', 'key mismatch');
    const before = await this.db.selectFrom('compatibility_categories').selectAll().where('key', '=', key).executeTakeFirst();
    return this.write(a, req, 'matching.category_upserted', { type: 'compatibility_category', id: key }, before ?? null, async (trx) => {
      const v = { source: body.source, position: body.position, is_active: body.isActive };
      const row = await trx.insertInto('compatibility_categories').values({ key, ...v }).onConflict((oc) => oc.column('key').doUpdateSet(v)).returningAll().executeTakeFirstOrThrow().catch(uniqueViolation);
      await trx.deleteFrom('compatibility_category_translations').where('category_id', '=', row.id).execute();
      await trx.insertInto('compatibility_category_translations').values(Object.entries(body.translations).map(([locale, t]) => ({ category_id: row.id, locale, label: t.label, description: t.description ?? null }))).execute();
      return row;
    });
  }

  @Get('deal-breakers')
  @RequirePermissions('matching.view')
  dealBreakers() {
    return this.db.selectFrom('deal_breakers').selectAll().orderBy('key').execute();
  }

  @Put('deal-breakers/:key')
  @RequirePermissions('matching.edit')
  async upsertDealBreaker(@CurrentAdmin() a: AdminContext, @Req() req: Request, @Param('key') key: string, @Body(new ZodPipe(adminDealBreakerUpsert)) body: B<typeof adminDealBreakerUpsert>) {
    if (key !== body.key) throw new AppError('VALIDATION_FAILED', 'key mismatch');
    if (body.subjectType === 'question' && !body.questionId) throw new AppError('VALIDATION_FAILED', 'questionId required for question deal-breakers');
    if (body.subjectType === 'attribute' && !body.attributeKind) throw new AppError('VALIDATION_FAILED', 'attributeKind required for attribute deal-breakers');
    const before = await this.db.selectFrom('deal_breakers').selectAll().where('key', '=', key).executeTakeFirst();
    return this.write(a, req, 'matching.deal_breaker_upserted', { type: 'deal_breaker', id: key }, before ?? null, (trx) => {
      const v = { subject_type: body.subjectType, question_id: body.questionId, attribute_kind: body.attributeKind, mode: body.mode, requires_entitlement: body.requiresEntitlement, is_active: body.isActive };
      return trx.insertInto('deal_breakers').values({ key, ...v }).onConflict((oc) => oc.column('key').doUpdateSet(v)).returningAll().executeTakeFirstOrThrow();
    });
  }
}
