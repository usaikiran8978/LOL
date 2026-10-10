import { z } from 'zod';
import { locale, uuid } from './common';

export const AI_FEATURES = [
  'profile_coach', 'match_explanation', 'conversation_starter', 'conversation_coach', 'translation', 'date_planner', 'event_recommendation',
  'safety_classifier', 'scam_risk', 'onboarding_assistant', 'post_date_reflection', 'relationship_insights',
] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

export const aiProfileCoach = z.object({ focus: z.enum(['overall', 'bio', 'prompts', 'photos']).default('overall') });
export const aiMatchExplanation = z.object({ userId: uuid });
export const aiConversationStarters = z.object({ conversationId: uuid.optional(), userId: uuid.optional() }).refine((v) => !!v.conversationId !== !!v.userId, 'Provide conversationId or userId');
export const aiConversationCoach = z.object({ conversationId: uuid, goal: z.enum(['keep_going', 'suggest_date', 'repair', 'general']).default('general') });
export const aiTranslate = z.object({ messageId: uuid, targetLocale: locale });
export const aiScamCheck = z.object({ conversationId: uuid });
export const aiOnboardingAssist = z.object({ tone: z.enum(['warm', 'playful', 'direct', 'thoughtful']).default('warm') });
export const aiReflection = z.object({ matchId: uuid });

// ------------------------------------------------------------------ admin

export const adminAiProviderUpsert = z.object({
  kind: z.enum(['openai_compatible', 'anthropic']),
  baseUrl: z.url().nullable().default(null),
  /** Name of the secret (environment / secrets-manager key) holding the API key — never the key itself. */
  secretRef: z.string().regex(/^[A-Z][A-Z0-9_]{2,100}$/),
  isEnabled: z.boolean().default(false),
  timeoutMs: z.number().int().min(1000).max(120_000).default(30_000),
});
export const adminAiModelUpsert = z.object({
  providerKey: z.string().regex(/^[a-z0-9_]{2,64}$/),
  modelName: z.string().min(1).max(200),
  purpose: z.enum(['chat', 'embedding', 'moderation', 'translation', 'vision']),
  contextTokens: z.number().int().positive().nullable().default(null),
  inputCostPerMtok: z.number().min(0).nullable().default(null),
  outputCostPerMtok: z.number().min(0).nullable().default(null),
  isEnabled: z.boolean().default(true),
});
export const adminAiPromptVersion = z.object({
  systemPrompt: z.string().min(10).max(20000),
  userTemplate: z.string().min(1).max(20000),
  outputSchema: z.record(z.string(), z.unknown()),
  inputVariables: z.array(z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]{0,40}$/)).max(40),
  temperature: z.number().min(0).max(2).nullable().default(null),
  maxOutputTokens: z.number().int().min(16).max(8000).nullable().default(null),
  changeNote: z.string().max(1000).optional(),
});
export const adminAiFeatureConfig = z.object({
  isEnabled: z.boolean(),
  primaryModelId: uuid.nullable(),
  fallbackModelId: uuid.nullable().default(null),
  promptTemplateKey: z.string().regex(/^[a-z0-9_]{2,64}$/),
  temperature: z.number().min(0).max(2).nullable().default(null),
  maxInputTokens: z.number().int().min(100).max(200_000).default(4000),
  maxOutputTokens: z.number().int().min(16).max(8000).default(800),
  perUserDailyLimit: z.number().int().min(0).nullable().default(null),
  premiumDailyLimit: z.number().int().min(0).nullable().default(null),
  requiresEntitlement: z.string().max(50).nullable().default(null),
  monthlyBudgetUsd: z.number().min(0).nullable().default(null),
  moderateInput: z.boolean().default(true),
  moderateOutput: z.boolean().default(true),
  safetyThreshold: z.number().min(0).max(1).default(0.5),
  runAsync: z.boolean().default(false),
  requiresConsent: z.string().max(50).nullable().default('ai_assistance'),
});
export const adminAiTestRun = z.object({ variables: z.record(z.string(), z.string().max(20000)), modelId: uuid.optional() });
