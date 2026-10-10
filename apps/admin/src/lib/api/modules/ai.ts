import type { adminAiFeatureConfig, adminAiModelUpsert, adminAiPromptVersion, adminAiProviderUpsert, adminAiTestRun, AiFeature } from '@amora/shared';
import type { z } from 'zod';
import type { ApiClient } from '../client';

/*
 * Response shapes mirror apps/api/src/modules/ai/ai.controller.ts (AdminAiController), which returns database
 * rows as-is (snake_case; Postgres `numeric` columns arrive as strings). `@amora/shared` only defines the
 * request contracts for these endpoints.
 */

type In<T extends z.ZodType> = z.input<T>;
const enc = encodeURIComponent;

export type AiProviderKind = 'openai_compatible' | 'anthropic';
export type AiModelPurpose = 'chat' | 'embedding' | 'moderation' | 'translation' | 'vision';
export type AiPromptStatus = 'draft' | 'published' | 'archived';

export interface AiModel {
  id: string;
  provider_id: string;
  model_name: string;
  purpose: AiModelPurpose;
  context_tokens: number | null;
  input_cost_per_mtok: string | null;
  output_cost_per_mtok: string | null;
  is_enabled: boolean;
}

/** `secretPresent` says whether the env/secret named by `secret_ref` exists on the API host; the value is never returned. */
export interface AiProvider {
  id: string;
  key: string;
  kind: AiProviderKind;
  base_url: string | null;
  secret_ref: string;
  is_enabled: boolean;
  timeout_ms: number;
  created_at: string;
  updated_at: string;
  secretPresent: boolean;
  models: AiModel[];
}

export interface AiPromptVersion {
  id: string;
  template_id: string;
  version: number;
  status: AiPromptStatus;
  system_prompt: string;
  user_template: string;
  output_schema: unknown;
  input_variables: string[];
  temperature: string | null;
  max_output_tokens: number | null;
  change_note: string | null;
  created_by: string | null;
  created_at: string;
  published_at: string | null;
  published_by: string | null;
}

export interface AiPromptTemplate {
  id: string;
  key: string;
  feature_key: string;
  description: string | null;
  created_at: string;
  /** Newest version first. */
  versions: AiPromptVersion[];
}

export interface AiFeatureConfig {
  feature_key: AiFeature;
  is_enabled: boolean;
  primary_model_id: string | null;
  fallback_model_id: string | null;
  prompt_template_id: string | null;
  temperature: string | null;
  max_input_tokens: number;
  max_output_tokens: number;
  per_user_daily_limit: number | null;
  premium_daily_limit: number | null;
  requires_entitlement: string | null;
  monthly_budget_usd: string | null;
  moderate_input: boolean;
  moderate_output: boolean;
  safety_threshold: string;
  run_async: boolean;
  requires_consent: string | null;
  updated_by: string | null;
  updated_at: string;
}

/** One row per feature and UTC day (`GET admin/ai/usage`). */
export interface AiUsageRow {
  feature_key: string;
  day: string;
  requests: number;
  succeeded: number;
  fallbacks: number;
  blocked: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: string;
  p95_latency_ms: number | null;
}

/** Gateway RunResult; the API returns no latency/token/cost figures for a test run. */
export interface AiTestRunResult {
  output: unknown;
  requestId: string;
  model: string;
  usedFallback: boolean;
}

export interface AiVersionRef {
  id: string;
  version: number;
  status: AiPromptStatus;
}

/** Typed wrappers for the ai admin endpoints. */
export function aiApi(c: ApiClient) {
  return {
    providers: () => c.get<AiProvider[]>('/admin/ai/providers'),
    upsertProvider: (key: string, body: In<typeof adminAiProviderUpsert>) => c.put<Omit<AiProvider, 'secretPresent' | 'models'>>(`/admin/ai/providers/${enc(key)}`, body),
    upsertModel: (body: In<typeof adminAiModelUpsert>) => c.post<AiModel>('/admin/ai/models', body),
    features: () => c.get<AiFeatureConfig[]>('/admin/ai/features'),
    upsertFeature: (key: string, body: In<typeof adminAiFeatureConfig>) => c.put<AiFeatureConfig>(`/admin/ai/features/${enc(key)}`, body),
    prompts: () => c.get<AiPromptTemplate[]>('/admin/ai/prompts'),
    createPromptVersion: (key: string, body: In<typeof adminAiPromptVersion>) => c.post<AiVersionRef>(`/admin/ai/prompts/${enc(key)}/versions`, body),
    publishPromptVersion: (id: string) => c.post<AiVersionRef>(`/admin/ai/prompts/versions/${enc(id)}/publish`, {}),
    testPromptVersion: (id: string, body: In<typeof adminAiTestRun>) => c.post<AiTestRunResult>(`/admin/ai/prompts/versions/${enc(id)}/test`, body),
    usage: (days: number) => c.get<AiUsageRow[]>('/admin/ai/usage', { days }),
  };
}
