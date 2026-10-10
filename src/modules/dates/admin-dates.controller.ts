import { Body, Controller, Get, Inject, Param, Put, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../../common/audit/audit.service';
import { DATABASE, type Database } from '../../common/db/database';
import { AppError } from '../../common/errors/app-error';
import { clientContext } from '../../common/http/request-context';
import { ZodPipe } from '../../common/http/zod.pipe';
import type { AdminContext } from '../admin/auth/admin-auth.service';
import { AdminGuard, CurrentAdmin, RequirePermissions } from '../admin/auth/admin.guard';
import { SettingsService } from '../platform/settings.service';
import { DATE_SAFETY_SETTINGS, type DateSafetySettingKey } from './date-safety.service';

const ideaBody = z.object({
  activityType: z.string().trim().min(2).max(50),
  budgetKey: z.string().max(50).nullable().default(null),
  dateStageKeys: z.array(z.string().max(50)).max(10).default([]),
  interestIds: z.array(z.uuid()).max(20).default([]),
  indoor: z.boolean().nullable().default(null),
  timeOfDay: z.array(z.enum(['morning', 'afternoon', 'evening', 'night'])).max(4).default([]),
  typicalDurationMin: z.number().int().min(10).max(1440).nullable().default(null),
  safetyTipsKey: z.string().max(100).nullable().default(null),
  isActive: z.boolean().default(true),
  translations: z.record(z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/), z.object({ title: z.string().trim().min(2).max(120), description: z.string().trim().min(2).max(1000) }))
    .refine((t) => !!t.en, { message: 'English (en) is required as the fallback locale' }),
});

/** Date-safety configuration and the date-idea catalog (`date_safety.manage`). */
@ApiTags('admin-dates')
@Controller('admin/dates')
@UseGuards(AdminGuard)
export class AdminDatesController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  @Get('safety/settings')
  @RequirePermissions('date_safety.manage')
  async safetySettings() {
    return Promise.all((Object.keys(DATE_SAFETY_SETTINGS) as DateSafetySettingKey[]).map(async (key) => {
      const d = DATE_SAFETY_SETTINGS[key];
      return { key, value: await this.settings.get<number>(key, d.fallback), min: d.min, max: d.max, description: d.description };
    }));
  }

  @Put('safety/settings/:key')
  @RequirePermissions('date_safety.manage')
  async setSafetySetting(@CurrentAdmin() a: AdminContext, @Req() req: Request, @Param('key') key: string, @Body(new ZodPipe(z.object({ value: z.number().int() }))) b: { value: number }) {
    const d = DATE_SAFETY_SETTINGS[key as DateSafetySettingKey];
    if (!d) throw new AppError('NOT_FOUND', 'Unknown date-safety setting');
    if (b.value < d.min || b.value > d.max) throw new AppError('VALIDATION_FAILED', `value must be between ${d.min} and ${d.max}`, { min: d.min, max: d.max });
    const before = await this.settings.get<number>(key, d.fallback);
    await this.db.transaction().execute(async (trx) => {
      const v = { value: JSON.stringify(b.value), value_type: 'number' as const, description: d.description, is_secret: false, updated_by: a.adminId };
      await trx.insertInto('system_settings').values({ key, ...v }).onConflict((oc) => oc.column('key').doUpdateSet({ ...v, updated_at: new Date() })).execute();
      await this.audit.record({ actorType: 'admin', actorId: a.adminId, action: 'date_safety.setting_updated', targetType: 'system_setting', targetId: key, before: { value: before }, after: { value: b.value }, client: clientContext(req) }, trx);
    });
    this.settings.invalidate();
    return { key, value: b.value };
  }

  @Get('ideas')
  @RequirePermissions('date_safety.manage')
  async ideas() {
    const [ideas, tr] = await Promise.all([
      this.db.selectFrom('date_ideas as i').leftJoin('taxonomy_terms as b', 'b.id', 'i.budget_term_id').selectAll('i').select('b.key as budget_key').orderBy('i.key').execute(),
      this.db.selectFrom('date_idea_translations').selectAll().execute(),
    ]);
    const stages = await this.db.selectFrom('taxonomy_terms').select(['id', 'key']).where('kind', '=', 'date_stage').execute();
    return ideas.map((i) => ({
      id: i.id, key: i.key, activityType: i.activity_type, budgetKey: i.budget_key, dateStageKeys: i.date_stage_term_ids.map((id) => stages.find((s) => s.id === id)?.key).filter(Boolean),
      interestIds: i.interest_ids, indoor: i.indoor, timeOfDay: i.time_of_day, typicalDurationMin: i.typical_duration_min, safetyTipsKey: i.safety_tips_key, isActive: i.is_active,
      translations: Object.fromEntries(tr.filter((t) => t.idea_id === i.id).map((t) => [t.locale, { title: t.title, description: t.description }])),
    }));
  }

  @Put('ideas/:key')
  @RequirePermissions('date_safety.manage')
  async upsertIdea(@CurrentAdmin() a: AdminContext, @Req() req: Request, @Param('key') key: string, @Body(new ZodPipe(ideaBody)) b: z.output<typeof ideaBody>) {
    if (!/^[a-z0-9_]{2,60}$/.test(key)) throw new AppError('VALIDATION_FAILED', 'key must be lowercase letters, digits or _');
    const term = async (kind: string, k: string) => (await this.db.selectFrom('taxonomy_terms').select('id').where('kind', '=', kind).where('key', '=', k).executeTakeFirst())?.id;
    const budget = b.budgetKey ? await term('budget_tier', b.budgetKey) : null;
    if (b.budgetKey && !budget) throw new AppError('VALIDATION_FAILED', 'Unknown budget tier');
    const stageIds: string[] = [];
    for (const s of b.dateStageKeys) {
      const id = await term('date_stage', s);
      if (!id) throw new AppError('VALIDATION_FAILED', `Unknown date stage ${s}`);
      stageIds.push(id);
    }
    if (b.interestIds.length) {
      const n = await this.db.selectFrom('interests').select('id').where('id', 'in', b.interestIds).execute();
      if (n.length !== new Set(b.interestIds).size) throw new AppError('VALIDATION_FAILED', 'Unknown interest');
    }
    const locales = Object.keys(b.translations);
    const known = await this.db.selectFrom('languages').select('code').where('code', 'in', locales).execute();
    if (known.length !== locales.length) throw new AppError('VALIDATION_FAILED', 'Unknown locale');
    const before = await this.db.selectFrom('date_ideas').selectAll().where('key', '=', key).executeTakeFirst();
    return this.db.transaction().execute(async (trx) => {
      const v = { activity_type: b.activityType, budget_term_id: budget ?? null, date_stage_term_ids: stageIds, interest_ids: b.interestIds, indoor: b.indoor, time_of_day: b.timeOfDay, typical_duration_min: b.typicalDurationMin, safety_tips_key: b.safetyTipsKey, is_active: b.isActive };
      const row = await trx.insertInto('date_ideas').values({ key, ...v }).onConflict((oc) => oc.column('key').doUpdateSet(v)).returning('id').executeTakeFirstOrThrow();
      await trx.deleteFrom('date_idea_translations').where('idea_id', '=', row.id).execute();
      await trx.insertInto('date_idea_translations').values(Object.entries(b.translations).map(([locale, t]) => ({ idea_id: row.id, locale, title: t.title, description: t.description }))).execute();
      await this.audit.record({ actorType: 'admin', actorId: a.adminId, action: before ? 'date_ideas.updated' : 'date_ideas.created', targetType: 'date_idea', targetId: row.id, before: before ?? null, after: v, client: clientContext(req) }, trx);
      return { id: row.id, key };
    });
  }
}
