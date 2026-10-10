import type { AiFeatureConfig, AiPromptTemplate, AiProvider, AiUsageRow } from '@/lib/api/modules/ai';

/** Test-only fixtures shaped like the AdminAiController responses. */
export const MODEL_ID = '11111111-1111-4111-8111-111111111111';
export const FALLBACK_ID = '22222222-2222-4222-8222-222222222222';
export const VERSION_DRAFT = '33333333-3333-4333-8333-333333333333';
export const VERSION_PUB = '44444444-4444-4444-8444-444444444444';

export const LEAKED_SECRET = 'sk-live-THIS-MUST-NEVER-RENDER';

export function providers(): AiProvider[] {
  return [
    {
      id: 'p1', key: 'openai', kind: 'openai_compatible', base_url: null, secret_ref: 'OPENAI_API_KEY', is_enabled: true, timeout_ms: 30000,
      created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', secretPresent: true,
      models: [
        { id: MODEL_ID, provider_id: 'p1', model_name: 'gpt-main', purpose: 'chat', context_tokens: 128000, input_cost_per_mtok: '1.2500', output_cost_per_mtok: '5.0000', is_enabled: true },
        { id: FALLBACK_ID, provider_id: 'p1', model_name: 'gpt-mini', purpose: 'chat', context_tokens: null, input_cost_per_mtok: null, output_cost_per_mtok: null, is_enabled: true },
      ],
    },
    {
      id: 'p2', key: 'claude', kind: 'anthropic', base_url: 'https://api.anthropic.com', secret_ref: 'ANTHROPIC_API_KEY', is_enabled: false, timeout_ms: 60000,
      created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', secretPresent: false, models: [],
    },
  ];
}

export function prompts(): AiPromptTemplate[] {
  return [
    {
      id: 't1', key: 'profile_coach', feature_key: 'profile_coach', description: 'Bio suggestions', created_at: '2026-01-01T00:00:00Z',
      versions: [
        {
          id: VERSION_DRAFT, template_id: 't1', version: 2, status: 'draft', system_prompt: 'Score the bio only, be brief.', user_template: 'Bio: {{bio}} Tone: {{tone}}',
          output_schema: { type: 'object', required: ['score'] }, input_variables: ['bio', 'tone'], temperature: '0.40', max_output_tokens: 400, change_note: 'Add tone',
          created_by: null, created_at: '2026-02-01T00:00:00Z', published_at: null, published_by: null,
        },
        {
          id: VERSION_PUB, template_id: 't1', version: 1, status: 'published', system_prompt: 'Score the bio only.', user_template: 'Bio: {{bio}}',
          output_schema: { type: 'object' }, input_variables: ['bio'], temperature: null, max_output_tokens: null, change_note: null,
          created_by: null, created_at: '2026-01-01T00:00:00Z', published_at: '2026-01-02T00:00:00Z', published_by: null,
        },
      ],
    },
  ];
}

export function featureConfig(overrides: Partial<AiFeatureConfig> = {}): AiFeatureConfig {
  return {
    feature_key: 'profile_coach', is_enabled: true, primary_model_id: MODEL_ID, fallback_model_id: null, prompt_template_id: 't1', temperature: null,
    max_input_tokens: 4000, max_output_tokens: 800, per_user_daily_limit: 2, premium_daily_limit: null, requires_entitlement: null, monthly_budget_usd: '100.00',
    moderate_input: true, moderate_output: true, safety_threshold: '0.500', run_async: false, requires_consent: 'ai_assistance', updated_by: null,
    updated_at: '2026-01-01T00:00:00Z', ...overrides,
  };
}

export function usage(): AiUsageRow[] {
  return [
    { feature_key: 'profile_coach', day: '2026-10-07', requests: 10, succeeded: 8, fallbacks: 1, blocked: 1, input_tokens: 1000, output_tokens: 500, cost_usd: '0.250000', p95_latency_ms: 1200 },
    { feature_key: 'translation', day: '2026-10-07', requests: 4, succeeded: 4, fallbacks: 0, blocked: 0, input_tokens: 200, output_tokens: 100, cost_usd: '0.050000', p95_latency_ms: 300 },
    { feature_key: 'profile_coach', day: '2026-10-06', requests: 6, succeeded: 6, fallbacks: 0, blocked: 0, input_tokens: 600, output_tokens: 300, cost_usd: '0.200000', p95_latency_ms: null },
  ];
}

/** Writes to the AI admin API only (renderSignedIn's mutations() also includes the login POST). */
export const aiWrites = (calls: Array<{ method: string; path: string; body: unknown }>) => calls.filter((c) => c.method !== 'GET' && c.path.startsWith('/admin/ai/'));
