import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AiFeature } from '@amora/shared';
import Ajv, { type ValidateFunction } from 'ajv';
import { sql } from 'kysely';
import { AnalyticsService } from '../../common/analytics/analytics.service';
import { DATABASE, type Database } from '../../common/db/database';
import { AppError } from '../../common/errors/app-error';
import { EntitlementsService } from '../platform/entitlements.service';
import { TextModerationService } from '../safety/text-moderation';
import { AnthropicClient, OpenAiCompatibleClient, type LlmClient } from './llm-clients';
import { extractJson, INJECTION_GUARD, renderPrompt, stringLeaves } from './prompting';

const CHARS_PER_TOKEN = 4;

export interface RunOptions {
  userId: string | null;            // null = system jobs (classification)
  /** Server-built values inserted verbatim (labels, counts); all other variables are treated as user content. */
  trusted?: string[];
  promptVersionId?: string;          // admin test-run of a specific (draft) version
  modelId?: string;                  // admin test-run override
  skipLimits?: boolean;              // system jobs / admin test-runs
}

export interface RunResult<T> {
  output: T;
  requestId: string;
  model: string;
  usedFallback: boolean;
}

type Status = 'succeeded' | 'failed' | 'blocked_input' | 'blocked_output' | 'schema_invalid' | 'rate_limited' | 'budget_exceeded' | 'escalated';

/**
 * AI gateway (TECH §8). Per call: feature config → consent → entitlement → per-user limit → monthly budget →
 * published prompt version → PII-minimized, injection-contained rendering → input moderation → model call with
 * schema validation and fallback model → output moderation → audit metadata (no prompt/response bodies stored).
 */
@Injectable()
export class AiGatewayService {
  private readonly logger = new Logger(AiGatewayService.name);
  private readonly ajv = new Ajv({ allErrors: false, strict: false });
  private readonly validators = new Map<string, ValidateFunction>();

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly moderation: TextModerationService,
    private readonly entitlements: EntitlementsService,
    private readonly analytics: AnalyticsService,
  ) {}

  /**
   * Configured + consent + entitlement checks, without counting usage. Also used before serving cached AI output
   * (e.g. translations) so a cache hit never bypasses consent or plan gating.
   */
  async assertAccess(feature: AiFeature, userId: string) {
    const cfg = await this.db.selectFrom('ai_feature_configs').selectAll().where('feature_key', '=', feature).executeTakeFirst();
    if (!cfg?.is_enabled || !cfg.primary_model_id || !cfg.prompt_template_id) throw new AppError('AI_NOT_CONFIGURED', `AI feature ${feature} is not configured`);
    if (cfg.requires_consent) {
      const c = await this.db.selectFrom('consent_records').select('granted').where('user_id', '=', userId).where('consent_type', '=', cfg.requires_consent).orderBy('created_at', 'desc').limit(1).executeTakeFirst();
      if (!c?.granted) throw new AppError('CONSENT_REQUIRED', 'AI assistance needs your consent', { kind: 'consent', consentType: cfg.requires_consent });
    }
    if (cfg.requires_entitlement) await this.entitlements.require(userId, cfg.requires_entitlement);
    return cfg;
  }

  async run<T>(feature: AiFeature, variables: Record<string, string>, opts: RunOptions): Promise<RunResult<T>> {
    const cfg = opts.userId && !opts.skipLimits ? await this.assertAccess(feature, opts.userId) : await this.db.selectFrom('ai_feature_configs').selectAll().where('feature_key', '=', feature).executeTakeFirst();
    if (!cfg?.is_enabled || !cfg.primary_model_id || !cfg.prompt_template_id) throw new AppError('AI_NOT_CONFIGURED', `AI feature ${feature} is not configured`);

    if (opts.userId && !opts.skipLimits) {
      const premium = await this.entitlements.has(opts.userId, 'ai_coach_advanced');
      const limit = premium ? (cfg.premium_daily_limit ?? cfg.per_user_daily_limit) : cfg.per_user_daily_limit;
      if (limit !== null) {
        const { n } = await this.db.selectFrom('ai_requests').select(sql<number>`count(*)::int`.as('n')).where('user_id', '=', opts.userId).where('feature_key', '=', feature)
          .where('status', '=', 'succeeded').where('created_at', '>=', startOfUtcDay()).executeTakeFirstOrThrow();
        if (n >= limit) {
          await this.audit(feature, opts.userId, null, null, false, 'rate_limited');
          throw new AppError('LIMIT_REACHED', 'Daily AI limit reached', { key: `ai:${feature}`, limit });
        }
      }
    }
    if (cfg.monthly_budget_usd !== null && !opts.skipLimits) {
      const { spent } = await this.db.selectFrom('ai_requests').select(sql<string>`coalesce(sum(cost_usd), 0)`.as('spent')).where('feature_key', '=', feature).where('created_at', '>=', startOfUtcMonth()).executeTakeFirstOrThrow();
      if (Number(spent) >= Number(cfg.monthly_budget_usd)) {
        await this.audit(feature, opts.userId, null, null, false, 'budget_exceeded');
        throw new AppError('AI_BUDGET_EXCEEDED');
      }
    }

    const version = await this.db.selectFrom('ai_prompt_versions').selectAll()
      .$if(!!opts.promptVersionId, (q) => q.where('id', '=', opts.promptVersionId!))
      .$if(!opts.promptVersionId, (q) => q.where('template_id', '=', cfg.prompt_template_id!).where('status', '=', 'published'))
      .executeTakeFirst();
    if (!version) throw new AppError('AI_NOT_CONFIGURED', 'No published prompt version');

    const trusted = new Set(opts.trusted ?? []);
    if (cfg.moderate_input) {
      const userText = Object.entries(variables).filter(([k]) => !trusted.has(k)).map(([, v]) => v).join('\n');
      const scan = await this.moderation.scan('message', userText);
      if (scan.action === 'hide') {
        await this.audit(feature, opts.userId, version.id, null, false, 'blocked_input', null, scan.matchedRules);
        throw new AppError('AI_INPUT_BLOCKED');
      }
    }
    const maxChars = cfg.max_input_tokens * CHARS_PER_TOKEN;
    const user = renderPrompt(version.user_template, variables, trusted, Math.floor(maxChars / Math.max(1, Object.keys(variables).length)));
    const system = `${version.system_prompt}\n\n${INJECTION_GUARD}\nJSON schema:\n${JSON.stringify(version.output_schema)}`;
    const validate = this.validator(version.id, version.output_schema as object);

    const modelIds = opts.modelId ? [opts.modelId] : [cfg.primary_model_id, ...(cfg.fallback_model_id ? [cfg.fallback_model_id] : [])];
    let lastError: { status: Status; message: string } = { status: 'failed', message: 'no model attempted' };
    for (const [i, modelId] of modelIds.entries()) {
      const model = await this.db.selectFrom('ai_models as m').innerJoin('ai_providers as p', 'p.id', 'm.provider_id')
        .select(['m.id', 'm.model_name', 'm.input_cost_per_mtok', 'm.output_cost_per_mtok', 'm.is_enabled', 'p.kind', 'p.base_url', 'p.secret_ref', 'p.is_enabled as provider_enabled', 'p.timeout_ms'])
        .where('m.id', '=', modelId).executeTakeFirst();
      if (!model || !model.is_enabled || !model.provider_enabled) continue;
      const apiKey = process.env[model.secret_ref];
      if (!apiKey) {
        lastError = { status: 'failed', message: `secret ${model.secret_ref} not set` };
        continue;
      }
      const client: LlmClient = model.kind === 'anthropic' ? new AnthropicClient(model.base_url ?? 'https://api.anthropic.com', apiKey) : new OpenAiCompatibleClient(model.base_url ?? 'https://api.openai.com/v1', apiKey);
      const started = Date.now();
      try {
        const res = await client.complete({
          model: model.model_name, system, user, temperature: version.temperature !== null ? Number(version.temperature) : cfg.temperature !== null ? Number(cfg.temperature) : null,
          maxOutputTokens: version.max_output_tokens ?? cfg.max_output_tokens, timeoutMs: model.timeout_ms,
        });
        const cost = ((res.inputTokens ?? 0) * Number(model.input_cost_per_mtok ?? 0) + (res.outputTokens ?? 0) * Number(model.output_cost_per_mtok ?? 0)) / 1_000_000;
        let parsed: unknown;
        try {
          parsed = extractJson(res.text);
        } catch {
          parsed = undefined;
        }
        if (parsed === undefined || !validate(parsed)) {
          lastError = { status: 'schema_invalid', message: this.ajv.errorsText(validate.errors) };
          await this.audit(feature, opts.userId, version.id, model.id, i > 0, 'schema_invalid', { res, cost, latency: Date.now() - started });
          continue;
        }
        if (cfg.moderate_output) {
          const scan = await this.moderation.scan('ai_output', stringLeaves(parsed).join('\n'));
          if (scan.action !== 'allow' || scan.score >= Number(cfg.safety_threshold)) {
            const id = await this.audit(feature, opts.userId, version.id, model.id, i > 0, 'blocked_output', { res, cost, latency: Date.now() - started }, scan.matchedRules);
            this.logger.warn(`AI output blocked for ${feature} (${id})`);
            throw new AppError('AI_UNAVAILABLE', 'The assistant could not produce a safe answer; please try again');
          }
        }
        const requestId = await this.audit(feature, opts.userId, version.id, model.id, i > 0, 'succeeded', { res, cost, latency: Date.now() - started });
        if (opts.userId) await this.analytics.track('ai_feature_used', { userId: opts.userId, properties: { feature } });
        return { output: parsed as T, requestId, model: model.model_name, usedFallback: i > 0 };
      } catch (err) {
        if (err instanceof AppError) throw err;
        lastError = { status: 'failed', message: (err as Error).message };
        await this.audit(feature, opts.userId, version.id, model.id, i > 0, 'failed', { res: null, cost: 0, latency: Date.now() - started }, undefined, (err as Error).message);
      }
    }
    this.logger.warn(`AI ${feature} failed on all models: ${lastError.message}`);
    throw new AppError('AI_UNAVAILABLE');
  }

  private validator(versionId: string, schema: object): ValidateFunction {
    let v = this.validators.get(versionId);
    if (!v) {
      v = this.ajv.compile(schema);
      this.validators.set(versionId, v);
    }
    return v;
  }

  /** Metadata only (TECH §8): no prompt or completion text is persisted. */
  private async audit(
    feature: string, userId: string | null, promptVersionId: string | null, modelId: string | null, usedFallback: boolean, status: Status,
    m?: { res: { inputTokens: number | null; outputTokens: number | null } | null; cost: number; latency: number } | null, flags?: string[], error?: string,
  ): Promise<string> {
    const row = await this.db.insertInto('ai_requests').values({
      feature_key: feature, user_id: userId, prompt_version_id: promptVersionId, model_id: modelId, used_fallback: usedFallback, status,
      input_tokens: m?.res?.inputTokens ?? null, output_tokens: m?.res?.outputTokens ?? null, cost_usd: m ? m.cost : null, latency_ms: m?.latency ?? null,
      moderation_flags: flags ?? null, error_code: error ? error.slice(0, 200) : null,
    }).returning('id').executeTakeFirstOrThrow();
    return row.id;
  }
}

function startOfUtcDay(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function startOfUtcMonth(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
