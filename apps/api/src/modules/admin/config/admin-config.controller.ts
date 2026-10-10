import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  adminCityUpsert, adminCmsUpsert, adminCountryUpsert, adminFlagUpsert, adminInterestCategoryUpsert, adminInterestUpsert, adminLanguageUpsert,
  adminLegalCreate, adminLegalDraftUpdate, adminLegalPublish, KNOWN_ONBOARDING_STEPS, PERMISSIONS, PREDICATE_FIELDS, TAXONOMY_KINDS, adminOnboardingFlowCreate, adminPromptUpsert, adminSegmentUpsert, adminSettingUpsert, adminTermUpsert,
  pageQuery, taxonomyKind,
} from '@amora/shared';
import type { Request } from 'express';
import { sql } from 'kysely';
import { z } from 'zod';
import { AuditService } from '../../../common/audit/audit.service';
import { DATABASE, type Database, type Tx } from '../../../common/db/database';
import { AppError } from '../../../common/errors/app-error';
import { geohashEncode } from '../../../common/geo/geo';
import { decodeCursor, encodeCursor } from '../../../common/http/cursor';
import { ZodPipe } from '../../../common/http/zod.pipe';
import { FlagsService } from '../../platform/flags.service';
import { SettingsService } from '../../platform/settings.service';
import { flowSteps } from '../../profiles/onboarding.service';
import type { AdminContext } from '../auth/admin-auth.service';
import { AuditedController, uniqueViolation } from '../common/audited';
import { AdminGuard, CurrentAdmin, RequirePermissions } from '../auth/admin.guard';

type B<T extends z.ZodType> = z.infer<T>;
const uuidParam = new ParseUUIDPipe();

// ------------------------------------------------------------------------------------------- taxonomy & catalog

@ApiTags('admin-taxonomy')
@Controller('admin/taxonomy')
@UseGuards(AdminGuard)
export class AdminTaxonomyController extends AuditedController {
  constructor(@Inject(DATABASE) db: Database, audit: AuditService) {
    super(db, audit);
  }

  @Get('terms')
  @RequirePermissions('taxonomy.manage')
  async terms(@Query('kind', new ZodPipe(taxonomyKind)) kind: z.infer<typeof taxonomyKind>) {
    const terms = await this.db.selectFrom('taxonomy_terms').selectAll().where('kind', '=', kind).orderBy('position').execute();
    const tr = terms.length ? await this.db.selectFrom('taxonomy_term_translations').selectAll().where('term_id', 'in', terms.map((t) => t.id)).execute() : [];
    return terms.map((t) => ({ ...t, translations: Object.fromEntries(tr.filter((x) => x.term_id === t.id).map((x) => [x.locale, { label: x.label, description: x.description }])) }));
  }

  @Post('terms')
  @RequirePermissions('taxonomy.manage')
  create(@CurrentAdmin() admin: AdminContext, @Req() req: Request, @Body(new ZodPipe(adminTermUpsert)) body: B<typeof adminTermUpsert>) {
    return this.write(admin, req, 'taxonomy.term_created', { type: 'taxonomy_term', id: body.key }, null, async (trx) => {
      const row = await trx
        .insertInto('taxonomy_terms')
        .values({ kind: body.kind, key: body.key, parent_id: body.parentId ?? null, position: body.position, is_sensitive: body.isSensitive, is_active: body.isActive, metadata: JSON.stringify(body.metadata) })
        .returningAll()
        .executeTakeFirstOrThrow()
        .catch(uniqueViolation);
      await this.saveTermTranslations(trx, row.id, body.translations);
      return row;
    });
  }

  @Put('terms/:id')
  @RequirePermissions('taxonomy.manage')
  async update(@CurrentAdmin() admin: AdminContext, @Req() req: Request, @Param('id', uuidParam) id: string, @Body(new ZodPipe(adminTermUpsert)) body: B<typeof adminTermUpsert>) {
    const before = await this.db.selectFrom('taxonomy_terms').selectAll().where('id', '=', id).executeTakeFirst();
    if (!before) throw new AppError('NOT_FOUND');
    if (before.kind !== body.kind || before.key !== body.key) throw new AppError('CONFLICT', 'kind and key are immutable (stable identifiers referenced by rules and analytics)');
    return this.write(admin, req, 'taxonomy.term_updated', { type: 'taxonomy_term', id }, before, async (trx) => {
      const row = await trx
        .updateTable('taxonomy_terms')
        .set({ parent_id: body.parentId ?? null, position: body.position, is_sensitive: body.isSensitive, is_active: body.isActive, metadata: JSON.stringify(body.metadata) })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.saveTermTranslations(trx, id, body.translations);
      return row;
    });
  }

  private async saveTermTranslations(trx: Tx, termId: string, translations: Record<string, { label: string; description?: string }>) {
    await trx.deleteFrom('taxonomy_term_translations').where('term_id', '=', termId).execute();
    await trx.insertInto('taxonomy_term_translations').values(Object.entries(translations).map(([locale, t]) => ({ term_id: termId, locale, label: t.label, description: t.description ?? null }))).execute();
  }

  @Get('interest-categories')
  @RequirePermissions('taxonomy.manage')
  async categories() {
    const cats = await this.db.selectFrom('interest_categories').selectAll().orderBy('position').execute();
    const tr = await this.db.selectFrom('interest_category_translations').selectAll().execute();
    return cats.map((c) => ({ ...c, translations: Object.fromEntries(tr.filter((t) => t.category_id === c.id).map((t) => [t.locale, { label: t.label }])) }));
  }

  @Post('interest-categories')
  @RequirePermissions('taxonomy.manage')
  createCategory(@CurrentAdmin() admin: AdminContext, @Req() req: Request, @Body(new ZodPipe(adminInterestCategoryUpsert)) body: B<typeof adminInterestCategoryUpsert>) {
    return this.write(admin, req, 'taxonomy.interest_category_created', { type: 'interest_category', id: body.key }, null, async (trx) => {
      const row = await trx.insertInto('interest_categories').values({ key: body.key, icon: body.icon ?? null, position: body.position, is_active: body.isActive }).returningAll().executeTakeFirstOrThrow().catch(uniqueViolation);
      await trx.insertInto('interest_category_translations').values(Object.entries(body.translations).map(([locale, t]) => ({ category_id: row.id, locale, label: t.label }))).execute();
      return row;
    });
  }

  @Put('interest-categories/:id')
  @RequirePermissions('taxonomy.manage')
  async updateCategory(@CurrentAdmin() admin: AdminContext, @Req() req: Request, @Param('id', uuidParam) id: string, @Body(new ZodPipe(adminInterestCategoryUpsert)) body: B<typeof adminInterestCategoryUpsert>) {
    const before = await this.db.selectFrom('interest_categories').selectAll().where('id', '=', id).executeTakeFirst();
    if (!before) throw new AppError('NOT_FOUND');
    return this.write(admin, req, 'taxonomy.interest_category_updated', { type: 'interest_category', id }, before, async (trx) => {
      const row = await trx.updateTable('interest_categories').set({ icon: body.icon ?? null, position: body.position, is_active: body.isActive }).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
      await trx.deleteFrom('interest_category_translations').where('category_id', '=', id).execute();
      await trx.insertInto('interest_category_translations').values(Object.entries(body.translations).map(([locale, t]) => ({ category_id: id, locale, label: t.label }))).execute();
      return row;
    });
  }

  @Get('interests')
  @RequirePermissions('taxonomy.manage')
  async interests() {
    const rows = await this.db.selectFrom('interests').selectAll().orderBy('category_id').orderBy('position').execute();
    const tr = await this.db.selectFrom('interest_translations').selectAll().execute();
    return rows.map((r) => ({ ...r, translations: Object.fromEntries(tr.filter((t) => t.interest_id === r.id).map((t) => [t.locale, { label: t.label }])) }));
  }

  @Post('interests')
  @RequirePermissions('taxonomy.manage')
  createInterest(@CurrentAdmin() admin: AdminContext, @Req() req: Request, @Body(new ZodPipe(adminInterestUpsert)) body: B<typeof adminInterestUpsert>) {
    return this.write(admin, req, 'taxonomy.interest_created', { type: 'interest', id: body.key }, null, async (trx) => {
      const row = await trx.insertInto('interests').values({ key: body.key, category_id: body.categoryId, icon: body.icon ?? null, position: body.position, is_active: body.isActive }).returningAll().executeTakeFirstOrThrow().catch(uniqueViolation);
      await trx.insertInto('interest_translations').values(Object.entries(body.translations).map(([locale, t]) => ({ interest_id: row.id, locale, label: t.label }))).execute();
      return row;
    });
  }

  @Put('interests/:id')
  @RequirePermissions('taxonomy.manage')
  async updateInterest(@CurrentAdmin() admin: AdminContext, @Req() req: Request, @Param('id', uuidParam) id: string, @Body(new ZodPipe(adminInterestUpsert)) body: B<typeof adminInterestUpsert>) {
    const before = await this.db.selectFrom('interests').selectAll().where('id', '=', id).executeTakeFirst();
    if (!before) throw new AppError('NOT_FOUND');
    return this.write(admin, req, 'taxonomy.interest_updated', { type: 'interest', id }, before, async (trx) => {
      const row = await trx.updateTable('interests').set({ category_id: body.categoryId, icon: body.icon ?? null, position: body.position, is_active: body.isActive }).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
      await trx.deleteFrom('interest_translations').where('interest_id', '=', id).execute();
      await trx.insertInto('interest_translations').values(Object.entries(body.translations).map(([locale, t]) => ({ interest_id: id, locale, label: t.label }))).execute();
      return row;
    });
  }

  @Get('prompts')
  @RequirePermissions('taxonomy.manage')
  async prompts() {
    const rows = await this.db.selectFrom('prompt_catalog').selectAll().orderBy('position').execute();
    const tr = await this.db.selectFrom('prompt_catalog_translations').selectAll().execute();
    return rows.map((r) => ({ ...r, translations: Object.fromEntries(tr.filter((t) => t.prompt_id === r.id).map((t) => [t.locale, { text: t.text }])) }));
  }

  @Post('prompts')
  @RequirePermissions('taxonomy.manage')
  createPrompt(@CurrentAdmin() admin: AdminContext, @Req() req: Request, @Body(new ZodPipe(adminPromptUpsert)) body: B<typeof adminPromptUpsert>) {
    return this.write(admin, req, 'taxonomy.prompt_created', { type: 'prompt', id: body.key }, null, async (trx) => {
      const row = await trx.insertInto('prompt_catalog').values({ key: body.key, category: body.category, position: body.position, is_active: body.isActive }).returningAll().executeTakeFirstOrThrow().catch(uniqueViolation);
      await trx.insertInto('prompt_catalog_translations').values(Object.entries(body.translations).map(([locale, t]) => ({ prompt_id: row.id, locale, text: t.text }))).execute();
      return row;
    });
  }

  @Put('prompts/:id')
  @RequirePermissions('taxonomy.manage')
  async updatePrompt(@CurrentAdmin() admin: AdminContext, @Req() req: Request, @Param('id', uuidParam) id: string, @Body(new ZodPipe(adminPromptUpsert)) body: B<typeof adminPromptUpsert>) {
    const before = await this.db.selectFrom('prompt_catalog').selectAll().where('id', '=', id).executeTakeFirst();
    if (!before) throw new AppError('NOT_FOUND');
    return this.write(admin, req, 'taxonomy.prompt_updated', { type: 'prompt', id }, before, async (trx) => {
      const row = await trx.updateTable('prompt_catalog').set({ category: body.category, position: body.position, is_active: body.isActive }).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
      await trx.deleteFrom('prompt_catalog_translations').where('prompt_id', '=', id).execute();
      await trx.insertInto('prompt_catalog_translations').values(Object.entries(body.translations).map(([locale, t]) => ({ prompt_id: id, locale, text: t.text }))).execute();
      return row;
    });
  }
}

// ------------------------------------------------------------------------------------------- geo

@ApiTags('admin-geo')
@Controller('admin/geo')
@UseGuards(AdminGuard)
export class AdminGeoController extends AuditedController {
  constructor(@Inject(DATABASE) db: Database, audit: AuditService) {
    super(db, audit);
  }

  @Get('countries')
  @RequirePermissions('geo.manage')
  countries() {
    return this.db.selectFrom('countries as c').leftJoin('country_configs as cc', 'cc.country_code', 'c.code').selectAll('c').select([
      'cc.min_age', 'cc.emergency_number', 'cc.crossed_paths_allowed', 'cc.identity_verification_available', 'cc.religion_field_enabled', 'cc.data_region', 'cc.privacy_regime', 'cc.data_retention_days',
    ]).orderBy('c.name').execute();
  }

  @Put('countries/:code')
  @RequirePermissions('geo.manage')
  async upsertCountry(@CurrentAdmin() admin: AdminContext, @Req() req: Request, @Param('code') code: string, @Body(new ZodPipe(adminCountryUpsert)) body: B<typeof adminCountryUpsert>) {
    if (code !== body.code) throw new AppError('VALIDATION_FAILED', 'code mismatch');
    const before = await this.db.selectFrom('countries as c').leftJoin('country_configs as cc', 'cc.country_code', 'c.code').selectAll().where('c.code', '=', code).executeTakeFirst();
    return this.write(admin, req, 'geo.country_upserted', { type: 'country', id: code }, before ?? null, async (trx) => {
      const c = { name: body.name, default_locale: body.defaultLocale, default_currency: body.defaultCurrency, measurement: body.measurement, is_active: body.isActive };
      await trx.insertInto('countries').values({ code, ...c }).onConflict((oc) => oc.column('code').doUpdateSet(c)).execute();
      const cfg = {
        min_age: body.config.minAge, emergency_number: body.config.emergencyNumber, crossed_paths_allowed: body.config.crossedPathsAllowed,
        identity_verification_available: body.config.identityVerificationAvailable, religion_field_enabled: body.config.religionFieldEnabled,
        data_region: body.config.dataRegion, privacy_regime: body.config.privacyRegime, data_retention_days: body.config.dataRetentionDays,
        updated_by: admin.adminId, updated_at: new Date(),
      };
      await trx.insertInto('country_configs').values({ country_code: code, ...cfg }).onConflict((oc) => oc.column('country_code').doUpdateSet(cfg)).execute();
      return body;
    });
  }

  @Get('cities')
  @RequirePermissions('geo.manage')
  async cities(@Query(new ZodPipe(pageQuery.extend({ country: z.string().length(2).optional(), q: z.string().max(80).optional() }))) q: { cursor?: string; limit: number; country?: string; q?: string }) {
    const cursor = decodeCursor<[string, string]>(q.cursor, 2);
    let qb = this.db.selectFrom('cities').selectAll().orderBy('name').orderBy('id').limit(q.limit + 1);
    if (q.country) qb = qb.where('country_code', '=', q.country);
    if (q.q) qb = qb.where('name', 'ilike', `%${q.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
    if (cursor) qb = qb.where((eb) => eb.or([eb('name', '>', cursor[0]), eb.and([eb('name', '=', cursor[0]), eb('id', '>', cursor[1])])]));
    const rows = await qb.execute();
    const items = rows.slice(0, q.limit);
    return { items, nextCursor: rows.length > q.limit ? encodeCursor([items.at(-1)!.name, items.at(-1)!.id]) : null };
  }

  @Post('cities')
  @RequirePermissions('geo.manage')
  createCity(@CurrentAdmin() admin: AdminContext, @Req() req: Request, @Body(new ZodPipe(adminCityUpsert)) body: B<typeof adminCityUpsert>) {
    return this.write(admin, req, 'geo.city_created', { type: 'city', id: body.name }, null, (trx) =>
      trx.insertInto('cities').values({
        country_code: body.countryCode, name: body.name, admin_region: body.adminRegion ?? null, latitude: body.latitude, longitude: body.longitude,
        geohash5: geohashEncode(body.latitude, body.longitude, 5), timezone: body.timezone, population: body.population ?? null, is_active: body.isActive,
      }).returningAll().executeTakeFirstOrThrow(),
    );
  }

  @Put('cities/:id')
  @RequirePermissions('geo.manage')
  async updateCity(@CurrentAdmin() admin: AdminContext, @Req() req: Request, @Param('id', uuidParam) id: string, @Body(new ZodPipe(adminCityUpsert)) body: B<typeof adminCityUpsert>) {
    const before = await this.db.selectFrom('cities').selectAll().where('id', '=', id).executeTakeFirst();
    if (!before) throw new AppError('NOT_FOUND');
    return this.write(admin, req, 'geo.city_updated', { type: 'city', id }, before, (trx) =>
      trx.updateTable('cities').set({
        country_code: body.countryCode, name: body.name, admin_region: body.adminRegion ?? null, latitude: body.latitude, longitude: body.longitude,
        geohash5: geohashEncode(body.latitude, body.longitude, 5), timezone: body.timezone, population: body.population ?? null, is_active: body.isActive,
      }).where('id', '=', id).returningAll().executeTakeFirstOrThrow(),
    );
  }

  @Get('languages')
  @RequirePermissions('geo.manage')
  languages() {
    return this.db.selectFrom('languages').selectAll().orderBy('name').execute();
  }

  @Put('languages/:code')
  @RequirePermissions('geo.manage')
  async upsertLanguage(@CurrentAdmin() admin: AdminContext, @Req() req: Request, @Param('code') code: string, @Body(new ZodPipe(adminLanguageUpsert)) body: B<typeof adminLanguageUpsert>) {
    if (code !== body.code) throw new AppError('VALIDATION_FAILED', 'code mismatch');
    const before = await this.db.selectFrom('languages').selectAll().where('code', '=', code).executeTakeFirst();
    return this.write(admin, req, 'geo.language_upserted', { type: 'language', id: code }, before ?? null, async (trx) => {
      const v = { name: body.name, native_name: body.nativeName, is_rtl: body.isRtl, is_app_locale: body.isAppLocale, is_active: body.isActive };
      await trx.insertInto('languages').values({ code, ...v }).onConflict((oc) => oc.column('code').doUpdateSet(v)).execute();
      return body;
    });
  }
}

// ------------------------------------------------------------------------------------------- flags, segments, settings

@ApiTags('admin-config')
@Controller('admin/config')
@UseGuards(AdminGuard)
export class AdminPlatformConfigController extends AuditedController {
  constructor(
    @Inject(DATABASE) db: Database,
    audit: AuditService,
    private readonly flags: FlagsService,
    private readonly settings: SettingsService,
  ) {
    super(db, audit);
  }

  @Get('flags')
  @RequirePermissions('flags.manage')
  async listFlags() {
    const flags = await this.db.selectFrom('feature_flags').selectAll().orderBy('key').execute();
    const rules = await this.db.selectFrom('feature_flag_rules').selectAll().orderBy('priority').execute();
    return flags.map((f) => ({ ...f, rules: rules.filter((r) => r.flag_id === f.id) }));
  }

  @Put('flags/:key')
  @RequirePermissions('flags.manage')
  async upsertFlag(@CurrentAdmin() admin: AdminContext, @Req() req: Request, @Param('key') key: string, @Body(new ZodPipe(adminFlagUpsert)) body: B<typeof adminFlagUpsert>) {
    if (key !== body.key) throw new AppError('VALIDATION_FAILED', 'key mismatch');
    for (const r of body.rules) {
      const ok = { country: !!r.countryCodes?.length, percentage: r.percentage !== undefined, segment: !!r.segmentKey, user: !!r.userIds?.length, platform: !!r.platforms?.length, app_version: !!r.minAppVersion }[r.ruleType];
      if (!ok) throw new AppError('VALIDATION_FAILED', `rule of type ${r.ruleType} is missing its target`);
    }
    const before = (await this.listFlags()).find((f) => f.key === key) ?? null;
    const result = await this.write(admin, req, 'flags.upserted', { type: 'feature_flag', id: key }, before, async (trx) => {
      const flag = await trx
        .insertInto('feature_flags')
        .values({ key, description: body.description ?? null, enabled: body.enabled, default_value: body.defaultValue, updated_by: admin.adminId })
        .onConflict((oc) => oc.column('key').doUpdateSet({ description: body.description ?? null, enabled: body.enabled, default_value: body.defaultValue, updated_by: admin.adminId }))
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx.deleteFrom('feature_flag_rules').where('flag_id', '=', flag.id).execute();
      if (body.rules.length) {
        await trx.insertInto('feature_flag_rules').values(body.rules.map((r, i) => ({
          flag_id: flag.id, priority: i, rule_type: r.ruleType, country_codes: r.countryCodes ?? null, percentage: r.percentage ?? null,
          segment_key: r.segmentKey ?? null, user_ids: r.userIds ?? null, platforms: r.platforms ?? null, min_app_version: r.minAppVersion ?? null, value: r.value,
        }))).execute();
      }
      return body;
    });
    this.flags.invalidate();
    return result;
  }

  @Get('segments')
  @RequirePermissions('flags.manage')
  segments() {
    return this.db.selectFrom('user_segments').selectAll().orderBy('key').execute();
  }

  @Put('segments/:key')
  @RequirePermissions('flags.manage')
  async upsertSegment(@CurrentAdmin() admin: AdminContext, @Req() req: Request, @Param('key') key: string, @Body(new ZodPipe(adminSegmentUpsert)) body: B<typeof adminSegmentUpsert>) {
    if (key !== body.key) throw new AppError('VALIDATION_FAILED', 'key mismatch');
    const before = await this.db.selectFrom('user_segments').selectAll().where('key', '=', key).executeTakeFirst();
    const r = await this.write(admin, req, 'segments.upserted', { type: 'user_segment', id: key }, before ?? null, (trx) =>
      trx.insertInto('user_segments').values({ key, description: body.description ?? null, definition: JSON.stringify(body.definition) })
        .onConflict((oc) => oc.column('key').doUpdateSet({ description: body.description ?? null, definition: JSON.stringify(body.definition) }))
        .returningAll().executeTakeFirstOrThrow(),
    );
    this.flags.invalidate();
    return r;
  }

  /** Metadata the console needs to build editors (step keys, predicate fields, permission catalog). */
  @Get('catalog')
  @RequirePermissions()
  catalog() {
    return { onboardingSteps: KNOWN_ONBOARDING_STEPS, predicateFields: PREDICATE_FIELDS, permissions: PERMISSIONS, taxonomyKinds: TAXONOMY_KINDS };
  }

  @Delete('segments/:key')
  @HttpCode(204)
  @RequirePermissions('flags.manage')
  async deleteSegment(@CurrentAdmin() admin: AdminContext, @Req() req: Request, @Param('key') key: string) {
    const before = await this.db.selectFrom('user_segments').selectAll().where('key', '=', key).executeTakeFirst();
    if (!before) throw new AppError('NOT_FOUND');
    const used = await this.db.selectFrom('feature_flag_rules').select('id').where('segment_key', '=', key).executeTakeFirst();
    const usedByExperiment = await this.db.selectFrom('experiments').select('key').where('segment_id', '=', before.id).where('status', 'in', ['draft', 'running', 'paused']).executeTakeFirst();
    if (used || usedByExperiment) throw new AppError('CONFLICT', 'Segment is used by a feature flag or experiment');
    await this.write(admin, req, 'segments.deleted', { type: 'user_segment', id: key }, before, (trx) => trx.deleteFrom('user_segments').where('key', '=', key).execute());
    this.flags.invalidate();
  }

  @Get('settings')
  @RequirePermissions('settings.manage')
  listSettings() {
    // Secret settings are listed without their value.
    return this.db.selectFrom('system_settings').select(['key', 'value_type', 'description', 'is_secret', 'updated_at', 'updated_by', sql<unknown>`CASE WHEN is_secret THEN NULL ELSE value END`.as('value')]).orderBy('key').execute();
  }

  @Put('settings/:key')
  @RequirePermissions('settings.manage')
  async upsertSetting(@CurrentAdmin() admin: AdminContext, @Req() req: Request, @Param('key') key: string, @Body(new ZodPipe(adminSettingUpsert)) body: B<typeof adminSettingUpsert>) {
    if (!/^[a-z0-9_.]{2,100}$/.test(key)) throw new AppError('VALIDATION_FAILED', 'invalid key');
    const before = await this.db.selectFrom('system_settings').selectAll().where('key', '=', key).executeTakeFirst();
    if (body.value === undefined && !before) throw new AppError('VALIDATION_FAILED', 'value is required for a new setting');
    const value = body.value === undefined ? before!.value : body.value;
    const typeOk = { string: typeof value === 'string', number: typeof value === 'number', boolean: typeof value === 'boolean', json: value !== undefined, duration: typeof value === 'number' && value >= 0 }[body.valueType];
    if (!typeOk) throw new AppError('VALIDATION_FAILED', `value does not match type ${body.valueType}`);
    const isSecret = body.isSecret ?? before?.is_secret ?? false;
    // Secret values never enter the audit trail.
    const redact = (row: unknown) => (isSecret && row && typeof row === 'object' ? { ...(row as object), value: '[secret]' } : row);
    const r = await this.write(admin, req, 'settings.upserted', { type: 'system_setting', id: key }, redact(before ?? null), async (trx) => {
      const v = { value: JSON.stringify(value), value_type: body.valueType, description: body.description ?? before?.description ?? null, is_secret: isSecret, updated_by: admin.adminId };
      const row = await trx.insertInto('system_settings').values({ key, ...v }).onConflict((oc) => oc.column('key').doUpdateSet({ ...v, updated_at: new Date() })).returning(['key', 'value', 'value_type', 'is_secret']).executeTakeFirstOrThrow();
      return redact(row) as typeof row;
    });
    this.settings.invalidate();
    return r;
  }

  @Get('onboarding-flows')
  @RequirePermissions('onboarding.manage')
  flows() {
    return this.db.selectFrom('onboarding_flows').selectAll().orderBy('version', 'desc').execute();
  }

  @Post('onboarding-flows')
  @RequirePermissions('onboarding.manage')
  async createFlow(@CurrentAdmin() admin: AdminContext, @Req() req: Request, @Body(new ZodPipe(adminOnboardingFlowCreate)) body: B<typeof adminOnboardingFlowCreate>) {
    const steps = flowSteps.safeParse(body.steps);
    if (!steps.success) throw new AppError('VALIDATION_FAILED', steps.error.issues[0]?.message ?? 'invalid steps');
    const { v } = await this.db.selectFrom('onboarding_flows').select(sql<number>`coalesce(max(version), 0) + 1`.as('v')).executeTakeFirstOrThrow();
    return this.write(admin, req, 'onboarding.flow_created', { type: 'onboarding_flow', id: String(v) }, null, (trx) =>
      trx.insertInto('onboarding_flows').values({ version: v, status: 'draft', steps: JSON.stringify(steps.data) }).returningAll().executeTakeFirstOrThrow(),
    );
  }

  @Post('onboarding-flows/:version/publish')
  @HttpCode(200)
  @RequirePermissions('onboarding.manage')
  async publishFlow(@CurrentAdmin() admin: AdminContext, @Req() req: Request, @Param('version') version: string) {
    const v = Number(version);
    const flow = await this.db.selectFrom('onboarding_flows').selectAll().where('version', '=', v).executeTakeFirst();
    if (!flow) throw new AppError('NOT_FOUND');
    if (flow.status !== 'draft') throw new AppError('CONFLICT', 'Only drafts can be published');
    return this.write(admin, req, 'onboarding.flow_published', { type: 'onboarding_flow', id: version }, flow, async (trx) => {
      await trx.updateTable('onboarding_flows').set({ status: 'archived' }).where('status', '=', 'published').execute();
      return trx.updateTable('onboarding_flows').set({ status: 'published', published_at: new Date(), published_by: admin.adminId }).where('version', '=', v).returningAll().executeTakeFirstOrThrow();
    });
  }
}

// ------------------------------------------------------------------------------------------- CMS & legal

@ApiTags('admin-content')
@Controller('admin/content')
@UseGuards(AdminGuard)
export class AdminContentController extends AuditedController {
  constructor(@Inject(DATABASE) db: Database, audit: AuditService) {
    super(db, audit);
  }

  @Get('cms')
  @RequirePermissions('cms.manage')
  async listCms(@Query('kind') kind?: string) {
    let qb = this.db.selectFrom('cms_entries').selectAll().orderBy('kind').orderBy('position');
    if (kind) qb = qb.where('kind', '=', kind);
    const rows = await qb.execute();
    const tr = rows.length ? await this.db.selectFrom('cms_entry_translations').selectAll().where('entry_id', 'in', rows.map((r) => r.id)).execute() : [];
    return rows.map((r) => ({ ...r, translations: Object.fromEntries(tr.filter((t) => t.entry_id === r.id).map((t) => [t.locale, { title: t.title, bodyMarkdown: t.body_md }])) }));
  }

  @Put('cms/:key')
  @RequirePermissions('cms.manage')
  async upsertCms(@CurrentAdmin() admin: AdminContext, @Req() req: Request, @Param('key') key: string, @Body(new ZodPipe(adminCmsUpsert)) body: B<typeof adminCmsUpsert>) {
    if (key !== body.key) throw new AppError('VALIDATION_FAILED', 'key mismatch');
    const before = await this.db.selectFrom('cms_entries').selectAll().where('key', '=', key).executeTakeFirst();
    return this.write(admin, req, 'cms.upserted', { type: 'cms_entry', id: key }, before ?? null, async (trx) => {
      const v = {
        kind: body.kind, category: body.category ?? null, position: body.position, country_codes: body.countryCodes, status: body.status,
        publish_at: body.publishAt ? new Date(body.publishAt) : null, unpublish_at: body.unpublishAt ? new Date(body.unpublishAt) : null,
      };
      const row = await trx.insertInto('cms_entries').values({ key, ...v, created_by: admin.adminId }).onConflict((oc) => oc.column('key').doUpdateSet(v)).returningAll().executeTakeFirstOrThrow();
      await trx.deleteFrom('cms_entry_translations').where('entry_id', '=', row.id).execute();
      await trx.insertInto('cms_entry_translations').values(Object.entries(body.translations).map(([locale, t]) => ({ entry_id: row.id, locale, title: t.title, body_md: t.bodyMarkdown }))).execute();
      return row;
    });
  }

  @Delete('cms/:key')
  @HttpCode(204)
  @RequirePermissions('cms.manage')
  async archiveCms(@CurrentAdmin() admin: AdminContext, @Req() req: Request, @Param('key') key: string) {
    const before = await this.db.selectFrom('cms_entries').selectAll().where('key', '=', key).executeTakeFirst();
    if (!before) throw new AppError('NOT_FOUND');
    await this.write(admin, req, 'cms.archived', { type: 'cms_entry', id: key }, before, (trx) => trx.updateTable('cms_entries').set({ status: 'archived' }).where('key', '=', key).execute());
  }

  @Get('legal')
  @RequirePermissions('legal.manage')
  legal() {
    return this.db.selectFrom('legal_documents').select(['id', 'doc_type', 'version', 'locale', 'country_code', 'title', 'status', 'effective_at', 'requires_reacceptance', 'created_at']).orderBy('doc_type').orderBy('version', 'desc').execute();
  }

  @Get('legal/:id')
  @RequirePermissions('legal.manage')
  async legalDoc(@Param('id', uuidParam) id: string) {
    const d = await this.db.selectFrom('legal_documents').selectAll().where('id', '=', id).executeTakeFirst();
    if (!d) throw new AppError('NOT_FOUND');
    return d;
  }

  /** New legal text is always a new draft version; published versions are never edited (consents reference them). */
  @Post('legal')
  @RequirePermissions('legal.manage')
  async createLegal(@CurrentAdmin() admin: AdminContext, @Req() req: Request, @Body(new ZodPipe(adminLegalCreate)) body: B<typeof adminLegalCreate>) {
    const { v } = await this.db
      .selectFrom('legal_documents')
      .select(sql<number>`coalesce(max(version), 0) + 1`.as('v'))
      .where('doc_type', '=', body.docType)
      .where('locale', '=', body.locale)
      .where((eb) => (body.countryCode ? eb('country_code', '=', body.countryCode) : eb('country_code', 'is', null)))
      .executeTakeFirstOrThrow();
    return this.write(admin, req, 'legal.draft_created', { type: 'legal_document', id: `${body.docType}:${body.locale}:${v}` }, null, (trx) =>
      trx.insertInto('legal_documents').values({
        doc_type: body.docType, version: v, locale: body.locale, country_code: body.countryCode, title: body.title, body_md: body.bodyMarkdown,
        requires_reacceptance: body.requiresReacceptance, status: 'draft', created_by: admin.adminId,
      }).returning(['id', 'doc_type', 'version', 'locale', 'status']).executeTakeFirstOrThrow(),
    );
  }

  @Put('legal/:id')
  @RequirePermissions('legal.manage')
  async updateLegalDraft(@CurrentAdmin() admin: AdminContext, @Req() req: Request, @Param('id', uuidParam) id: string, @Body(new ZodPipe(adminLegalDraftUpdate)) body: B<typeof adminLegalDraftUpdate>) {
    const doc = await this.db.selectFrom('legal_documents').selectAll().where('id', '=', id).executeTakeFirst();
    if (!doc) throw new AppError('NOT_FOUND');
    if (doc.status !== 'draft') throw new AppError('VERSION_IMMUTABLE', 'Published legal documents cannot be edited; create a new version');
    return this.write(admin, req, 'legal.draft_updated', { type: 'legal_document', id }, { title: doc.title }, (trx) =>
      trx.updateTable('legal_documents').set({ title: body.title, body_md: body.bodyMarkdown, requires_reacceptance: body.requiresReacceptance }).where('id', '=', id).returning(['id', 'title', 'status']).executeTakeFirstOrThrow());
  }

  @Delete('legal/:id')
  @HttpCode(204)
  @RequirePermissions('legal.manage')
  async deleteLegalDraft(@CurrentAdmin() admin: AdminContext, @Req() req: Request, @Param('id', uuidParam) id: string) {
    const doc = await this.db.selectFrom('legal_documents').select(['status', 'title']).where('id', '=', id).executeTakeFirst();
    if (!doc) throw new AppError('NOT_FOUND');
    if (doc.status !== 'draft') throw new AppError('VERSION_IMMUTABLE', 'Only drafts can be deleted');
    await this.write(admin, req, 'legal.draft_deleted', { type: 'legal_document', id }, doc, (trx) => trx.deleteFrom('legal_documents').where('id', '=', id).execute());
  }

  @Post('legal/:id/publish')
  @HttpCode(200)
  @RequirePermissions('legal.manage')
  async publishLegal(@CurrentAdmin() admin: AdminContext, @Req() req: Request, @Param('id', uuidParam) id: string, @Body(new ZodPipe(adminLegalPublish)) body: B<typeof adminLegalPublish>) {
    const doc = await this.db.selectFrom('legal_documents').selectAll().where('id', '=', id).executeTakeFirst();
    if (!doc) throw new AppError('NOT_FOUND');
    if (doc.status !== 'draft') throw new AppError('CONFLICT', 'Only drafts can be published');
    return this.write(admin, req, 'legal.published', { type: 'legal_document', id }, { status: doc.status }, async (trx) => {
      await trx.updateTable('legal_documents').set({ status: 'archived' })
        .where('doc_type', '=', doc.doc_type).where('locale', '=', doc.locale).where('status', '=', 'published')
        .where((eb) => (doc.country_code ? eb('country_code', '=', doc.country_code) : eb('country_code', 'is', null))).execute();
      return trx.updateTable('legal_documents').set({ status: 'published', effective_at: body.effectiveAt ? new Date(body.effectiveAt) : new Date() }).where('id', '=', id).returning(['id', 'status', 'effective_at']).executeTakeFirstOrThrow();
    });
  }
}
