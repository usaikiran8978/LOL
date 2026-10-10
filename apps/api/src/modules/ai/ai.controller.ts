import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  adminAiFeatureConfig, adminAiModelUpsert, adminAiPromptVersion, adminAiProviderUpsert, adminAiTestRun, aiConversationCoach, aiConversationStarters, aiMatchExplanation,
  aiOnboardingAssist, aiProfileCoach, aiReflection, aiScamCheck, aiTranslate, AI_FEATURES, type AiFeature,
} from '@amora/shared';
import Ajv from 'ajv';
import type { Request } from 'express';
import { sql } from 'kysely';
import { z } from 'zod';
import { AuditService } from '../../common/audit/audit.service';
import { DATABASE, type Database } from '../../common/db/database';
import { AppError } from '../../common/errors/app-error';
import { requestLocale } from '../../common/http/locale';
import { ZodPipe } from '../../common/http/zod.pipe';
import type { AdminContext } from '../admin/auth/admin-auth.service';
import { AdminGuard, CurrentAdmin, RequirePermissions } from '../admin/auth/admin.guard';
import { AuditedController, uniqueViolation } from '../admin/common/audited';
import { CurrentUser, UserAuthGuard, type AuthContext } from '../auth/auth.guard';
import { AiFeaturesService } from './ai-features.service';
import { AiGatewayService } from './ai-gateway.service';

type B<T extends z.ZodType> = z.infer<T>;
const id = new ParseUUIDPipe();
// Expensive endpoints: a tighter per-IP budget on top of per-user daily limits.
const AI_THROTTLE = { default: { limit: 20, ttl: 60_000 } };

@ApiTags('ai')
@Controller('ai')
@UseGuards(UserAuthGuard)
@Throttle(AI_THROTTLE)
export class AiController {
  constructor(private readonly ai: AiFeaturesService) {}

  @Post('profile-coach')
  @HttpCode(200)
  coach(@CurrentUser() u: AuthContext, @Body(new ZodPipe(aiProfileCoach)) b: B<typeof aiProfileCoach>, @Req() req: Request) {
    return this.ai.profileCoach(u.userId, b.focus, requestLocale(req));
  }

  @Post('onboarding-assist')
  @HttpCode(200)
  onboarding(@CurrentUser() u: AuthContext, @Body(new ZodPipe(aiOnboardingAssist)) b: B<typeof aiOnboardingAssist>, @Req() req: Request) {
    return this.ai.onboardingAssist(u.userId, b.tone, requestLocale(req));
  }

  @Post('match-explanation')
  @HttpCode(200)
  explain(@CurrentUser() u: AuthContext, @Body(new ZodPipe(aiMatchExplanation)) b: B<typeof aiMatchExplanation>, @Req() req: Request) {
    return this.ai.matchExplanation(u.userId, b.userId, requestLocale(req));
  }

  @Post('conversation-starters')
  @HttpCode(200)
  starters(@CurrentUser() u: AuthContext, @Body(new ZodPipe(aiConversationStarters)) b: B<typeof aiConversationStarters>, @Req() req: Request) {
    return this.ai.conversationStarters(u.userId, b, requestLocale(req));
  }

  @Post('conversation-coach')
  @HttpCode(200)
  convCoach(@CurrentUser() u: AuthContext, @Body(new ZodPipe(aiConversationCoach)) b: B<typeof aiConversationCoach>, @Req() req: Request) {
    return this.ai.conversationCoach(u.userId, b.conversationId, b.goal, requestLocale(req));
  }

  @Post('scam-check')
  @HttpCode(200)
  scam(@CurrentUser() u: AuthContext, @Body(new ZodPipe(aiScamCheck)) b: B<typeof aiScamCheck>) {
    return this.ai.scamCheck(u.userId, b.conversationId);
  }

  @Post('translate')
  @HttpCode(200)
  translate(@CurrentUser() u: AuthContext, @Body(new ZodPipe(aiTranslate)) b: B<typeof aiTranslate>) {
    return this.ai.translate(u.userId, b.messageId, b.targetLocale);
  }

  @Post('date-reflection')
  @HttpCode(200)
  reflection(@CurrentUser() u: AuthContext, @Body(new ZodPipe(aiReflection)) b: B<typeof aiReflection>, @Req() req: Request) {
    return this.ai.reflection(u.userId, b.matchId, requestLocale(req));
  }

  @Post('relationship-insights')
  @HttpCode(200)
  insights(@CurrentUser() u: AuthContext, @Req() req: Request) {
    return this.ai.relationshipInsights(u.userId, requestLocale(req));
  }
}

@ApiTags('admin-ai')
@Controller('admin/ai')
@UseGuards(AdminGuard)
export class AdminAiController extends AuditedController {
  private readonly ajv = new Ajv({ strict: false });

  constructor(
    @Inject(DATABASE) db: Database,
    audit: AuditService,
    private readonly gateway: AiGatewayService,
  ) {
    super(db, audit);
  }

  @Get('providers')
  @RequirePermissions('ai.view')
  async providers() {
    const [p, m] = await Promise.all([this.db.selectFrom('ai_providers').selectAll().orderBy('key').execute(), this.db.selectFrom('ai_models').selectAll().execute()]);
    // Whether the referenced secret is present in this environment (value never returned).
    return p.map((x) => ({ ...x, secretPresent: !!process.env[x.secret_ref], models: m.filter((y) => y.provider_id === x.id) }));
  }

  @Put('providers/:key')
  @RequirePermissions('ai.manage')
  async upsertProvider(@CurrentAdmin() a: AdminContext, @Req() req: Request, @Param('key') key: string, @Body(new ZodPipe(adminAiProviderUpsert)) b: B<typeof adminAiProviderUpsert>) {
    if (!/^[a-z0-9_]{2,64}$/.test(key)) throw new AppError('VALIDATION_FAILED', 'invalid key');
    const before = await this.db.selectFrom('ai_providers').selectAll().where('key', '=', key).executeTakeFirst();
    return this.write(a, req, 'ai.provider_upserted', { type: 'ai_provider', id: key }, before ?? null, (trx) => {
      const v = { kind: b.kind, base_url: b.baseUrl, secret_ref: b.secretRef, is_enabled: b.isEnabled, timeout_ms: b.timeoutMs };
      return trx.insertInto('ai_providers').values({ key, ...v }).onConflict((oc) => oc.column('key').doUpdateSet(v)).returningAll().executeTakeFirstOrThrow();
    });
  }

  @Post('models')
  @RequirePermissions('ai.manage')
  async upsertModel(@CurrentAdmin() a: AdminContext, @Req() req: Request, @Body(new ZodPipe(adminAiModelUpsert)) b: B<typeof adminAiModelUpsert>) {
    const p = await this.db.selectFrom('ai_providers').select('id').where('key', '=', b.providerKey).executeTakeFirst();
    if (!p) throw new AppError('NOT_FOUND', 'Unknown provider');
    return this.write(a, req, 'ai.model_upserted', { type: 'ai_model', id: `${b.providerKey}:${b.modelName}` }, null, (trx) => {
      const v = { purpose: b.purpose, context_tokens: b.contextTokens, input_cost_per_mtok: b.inputCostPerMtok, output_cost_per_mtok: b.outputCostPerMtok, is_enabled: b.isEnabled };
      return trx.insertInto('ai_models').values({ provider_id: p.id, model_name: b.modelName, ...v }).onConflict((oc) => oc.columns(['provider_id', 'model_name']).doUpdateSet(v)).returningAll().executeTakeFirstOrThrow();
    });
  }

  @Get('prompts')
  @RequirePermissions('ai.view')
  async prompts() {
    const [t, v] = await Promise.all([this.db.selectFrom('ai_prompt_templates').selectAll().orderBy('key').execute(), this.db.selectFrom('ai_prompt_versions').selectAll().orderBy('version', 'desc').execute()]);
    return t.map((x) => ({ ...x, versions: v.filter((y) => y.template_id === x.id) }));
  }

  @Post('prompts/:key/versions')
  @RequirePermissions('ai.prompts.edit')
  async createPromptVersion(@CurrentAdmin() a: AdminContext, @Req() req: Request, @Param('key') key: string, @Body(new ZodPipe(adminAiPromptVersion)) b: B<typeof adminAiPromptVersion>) {
    const t = await this.db.selectFrom('ai_prompt_templates').select('id').where('key', '=', key).executeTakeFirst();
    if (!t) throw new AppError('NOT_FOUND');
    try {
      this.ajv.compile(b.outputSchema);
    } catch (err) {
      throw new AppError('VALIDATION_FAILED', `Invalid output JSON Schema: ${(err as Error).message}`);
    }
    const used = [...b.userTemplate.matchAll(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g)].map((m) => m[1]!);
    const undeclared = used.filter((u) => !b.inputVariables.includes(u));
    if (undeclared.length) throw new AppError('VALIDATION_FAILED', `Undeclared variables: ${undeclared.join(', ')}`);
    return this.write(a, req, 'ai.prompt_version_created', { type: 'ai_prompt_template', id: key }, null, async (trx) => {
      const { v } = await trx.selectFrom('ai_prompt_versions').select(sql<number>`coalesce(max(version), 0) + 1`.as('v')).where('template_id', '=', t.id).executeTakeFirstOrThrow();
      return trx.insertInto('ai_prompt_versions').values({
        template_id: t.id, version: v, status: 'draft', system_prompt: b.systemPrompt, user_template: b.userTemplate, output_schema: JSON.stringify(b.outputSchema),
        input_variables: b.inputVariables, temperature: b.temperature, max_output_tokens: b.maxOutputTokens, change_note: b.changeNote ?? null, created_by: a.adminId,
      }).returning(['id', 'version', 'status']).executeTakeFirstOrThrow();
    });
  }

  @Post('prompts/versions/:id/publish')
  @HttpCode(200)
  @RequirePermissions('ai.prompts.publish')
  async publishPrompt(@CurrentAdmin() a: AdminContext, @Req() req: Request, @Param('id', id) vid: string) {
    const v = await this.db.selectFrom('ai_prompt_versions').select(['id', 'template_id', 'status']).where('id', '=', vid).executeTakeFirst();
    if (!v) throw new AppError('NOT_FOUND');
    if (v.status !== 'draft') throw new AppError('VERSION_IMMUTABLE');
    return this.write(a, req, 'ai.prompt_published', { type: 'ai_prompt_version', id: vid }, null, async (trx) => {
      await trx.updateTable('ai_prompt_versions').set({ status: 'archived' }).where('template_id', '=', v.template_id).where('status', '=', 'published').execute();
      return trx.updateTable('ai_prompt_versions').set({ status: 'published', published_at: new Date(), published_by: a.adminId }).where('id', '=', vid).returning(['id', 'version', 'status']).executeTakeFirstOrThrow();
    });
  }

  /** Runs a (draft or published) prompt version on sample inputs — never with real user data. */
  @Post('prompts/versions/:id/test')
  @HttpCode(200)
  @RequirePermissions('ai.prompts.edit')
  async testPrompt(@CurrentAdmin() a: AdminContext, @Req() req: Request, @Param('id', id) vid: string, @Body(new ZodPipe(adminAiTestRun)) b: B<typeof adminAiTestRun>) {
    const v = await this.db.selectFrom('ai_prompt_versions as v').innerJoin('ai_prompt_templates as t', 't.id', 'v.template_id').select(['t.feature_key']).where('v.id', '=', vid).executeTakeFirst();
    if (!v) throw new AppError('NOT_FOUND');
    await this.write(a, req, 'ai.prompt_tested', { type: 'ai_prompt_version', id: vid }, null, async () => ({ ok: true }));
    return this.gateway.run(v.feature_key as AiFeature, b.variables, { userId: null, promptVersionId: vid, modelId: b.modelId, skipLimits: true });
  }

  @Get('features')
  @RequirePermissions('ai.view')
  features() {
    return this.db.selectFrom('ai_feature_configs').selectAll().orderBy('feature_key').execute();
  }

  @Put('features/:key')
  @RequirePermissions('ai.manage')
  async upsertFeature(@CurrentAdmin() a: AdminContext, @Req() req: Request, @Param('key') key: string, @Body(new ZodPipe(adminAiFeatureConfig)) b: B<typeof adminAiFeatureConfig>) {
    if (!(AI_FEATURES as readonly string[]).includes(key)) throw new AppError('NOT_FOUND', 'Unknown AI feature');
    const tpl = await this.db.selectFrom('ai_prompt_templates').select('id').where('key', '=', b.promptTemplateKey).executeTakeFirst();
    if (!tpl) throw new AppError('VALIDATION_FAILED', 'Unknown prompt template');
    const before = await this.db.selectFrom('ai_feature_configs').selectAll().where('feature_key', '=', key).executeTakeFirst();
    return this.write(a, req, 'ai.feature_updated', { type: 'ai_feature', id: key }, before ?? null, (trx) => {
      const v = {
        is_enabled: b.isEnabled, primary_model_id: b.primaryModelId, fallback_model_id: b.fallbackModelId, prompt_template_id: tpl.id, temperature: b.temperature, max_input_tokens: b.maxInputTokens,
        max_output_tokens: b.maxOutputTokens, per_user_daily_limit: b.perUserDailyLimit, premium_daily_limit: b.premiumDailyLimit, requires_entitlement: b.requiresEntitlement,
        monthly_budget_usd: b.monthlyBudgetUsd, moderate_input: b.moderateInput, moderate_output: b.moderateOutput, safety_threshold: b.safetyThreshold, run_async: b.runAsync,
        requires_consent: b.requiresConsent, updated_by: a.adminId, updated_at: new Date(),
      };
      return trx.insertInto('ai_feature_configs').values({ feature_key: key, ...v }).onConflict((oc) => oc.column('feature_key').doUpdateSet(v)).returningAll().executeTakeFirstOrThrow().catch(uniqueViolation);
    });
  }

  /** Token / cost / failure monitoring per feature and day (TECH §8). */
  @Get('usage')
  @RequirePermissions('ai.view')
  usage(@Query(new ZodPipe(z.object({ days: z.coerce.number().int().min(1).max(90).default(14) }))) q: { days: number }) {
    return this.db.selectFrom('ai_requests')
      .select(['feature_key', sql<string>`date_trunc('day', created_at)::date::text`.as('day'), sql<number>`count(*)::int`.as('requests'),
        sql<number>`count(*) FILTER (WHERE status = 'succeeded')::int`.as('succeeded'), sql<number>`count(*) FILTER (WHERE used_fallback)::int`.as('fallbacks'),
        sql<number>`count(*) FILTER (WHERE status IN ('blocked_input','blocked_output'))::int`.as('blocked'), sql<number>`coalesce(sum(input_tokens), 0)::int`.as('input_tokens'),
        sql<number>`coalesce(sum(output_tokens), 0)::int`.as('output_tokens'), sql<string>`coalesce(sum(cost_usd), 0)::text`.as('cost_usd'), sql<number>`percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)`.as('p95_latency_ms')])
      .where('created_at', '>', new Date(Date.now() - q.days * 86_400_000)).groupBy(['feature_key', sql`date_trunc('day', created_at)`]).orderBy('day', 'desc').execute();
  }
}
