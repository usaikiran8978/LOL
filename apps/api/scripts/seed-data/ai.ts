/**
 * AI prompt templates (v1, published) with strict output schemas, and feature configs. Features stay disabled until an
 * admin registers a provider + model (no provider keys are seeded) — AI is never faked.
 */
import type { Transaction } from 'kysely';
import type { DB } from '../../src/common/db/schema';

const str = (max = 500) => ({ type: 'string', minLength: 1, maxLength: max });
const arr = (items: object, min = 1, max = 6) => ({ type: 'array', items, minItems: min, maxItems: max });
const obj = (props: Record<string, object>, required = Object.keys(props)) => ({ type: 'object', properties: props, required, additionalProperties: false });

const TONE = 'You are a warm, respectful dating coach for a relationship-focused app. Be concise, kind, inclusive and practical. ' +
  'Never shame, never make assumptions about gender roles, never encourage deception, pressure or moving off-platform early. Answer in the language given by "locale".';

const TEMPLATES: Array<{ key: string; feature: string; description: string; system: string; user: string; vars: string[]; schema: object; temperature?: number; consent?: string | null; entitlement?: string | null; daily?: number | null; premiumDaily?: number | null }> = [
  {
    key: 'profile_coach', feature: 'profile_coach', description: 'Profile improvement suggestions',
    system: `${TONE} Review the user's own dating profile and give specific, actionable improvements. Score overall quality 0-100.`,
    user: 'Focus: {{focus}}\nLocale: {{locale}}\nPhotos: {{photoCount}}\nCompleteness: {{completeness}}%\nIntent: {{intent}}\nInterests: {{interests}}\nProfession: {{profession}}\nBio: {{bio}}\nPrompts:\n{{prompts}}',
    vars: ['focus', 'locale', 'photoCount', 'completeness', 'intent', 'interests', 'profession', 'bio', 'prompts'],
    schema: obj({ score: { type: 'integer', minimum: 0, maximum: 100 }, suggestions: arr(obj({ area: { enum: ['bio', 'prompts', 'photos', 'interests', 'details'] }, tip: str(300) }), 1, 6), bioSuggestion: str(600) }, ['score', 'suggestions']),
    daily: 5, premiumDaily: 50,
  },
  {
    key: 'onboarding_assistant', feature: 'onboarding_assistant', description: 'Bio and prompt drafts from onboarding answers',
    system: `${TONE} Draft authentic bio options and prompt answers from the user's own details. Drafts are suggestions the user edits; keep them truthful to the inputs only.`,
    user: 'Locale: {{locale}}\nTone: {{tone}}\nIntent: {{intent}} / {{goal}}\nInterests: {{interests}}\nDetails: {{attributes}}\nProfession: {{profession}}\nCurrent bio: {{currentBio}}\nAvailable prompts (key: text):\n{{availablePrompts}}',
    vars: ['locale', 'tone', 'intent', 'goal', 'interests', 'attributes', 'profession', 'currentBio', 'availablePrompts'],
    schema: obj({ bioDrafts: arr(str(500), 1, 3), promptIdeas: arr(obj({ promptKey: str(64), answerDraft: str(300) }), 1, 3) }),
    daily: 5, premiumDaily: 30,
  },
  {
    key: 'match_explanation', feature: 'match_explanation', description: 'Explain a compatibility score from stored factors',
    system: `${TONE} Explain why two people may be compatible using ONLY the provided engine factors and shared interests. Do not invent facts. Mention one difference gently if present.`,
    user: 'Locale: {{locale}}\nCompatibility: {{compatibility}}\nCategory scores: {{factors}}\nTop factors: {{topFactors}}\nDifferences: {{differences}}\nShared interests: {{sharedInterests}}\nMy intent: {{myIntent}}\nTheir intent: {{theirIntent}}',
    vars: ['locale', 'compatibility', 'factors', 'topFactors', 'differences', 'sharedInterests', 'myIntent', 'theirIntent'],
    schema: obj({ summary: str(400), highlights: arr(str(200), 1, 4), conversationTopics: arr(str(200), 1, 4) }),
    daily: 20, premiumDaily: 200,
  },
  {
    key: 'conversation_starter', feature: 'conversation_starter', description: 'Profile-aware openers',
    system: `${TONE} Write 3-5 short, specific, friendly openers based on the other person's prompts and shared interests. No pickup lines, no compliments on bodies, no contact requests.`,
    user: 'Locale: {{locale}}\nShared interests: {{sharedInterests}}\nTheir interests: {{theirInterests}}\nTheir prompts:\n{{theirPrompts}}',
    vars: ['locale', 'sharedInterests', 'theirInterests', 'theirPrompts'],
    schema: obj({ starters: arr(str(200), 3, 5) }), temperature: 0.8, daily: 10, premiumDaily: 100,
  },
  {
    key: 'conversation_coach', feature: 'conversation_coach', description: 'Coaching on an ongoing chat',
    system: `${TONE} Read the transcript ("You" is the user) and coach the user toward a respectful, engaging conversation. If "goal" is suggest_date, suggest a low-pressure public first date idea. Never encourage manipulation.`,
    user: 'Locale: {{locale}}\nGoal: {{goal}}\nTranscript:\n{{transcript}}',
    vars: ['locale', 'goal', 'transcript'],
    schema: obj({ assessment: str(400), suggestions: arr(str(250), 1, 4), replyIdeas: arr(str(250), 1, 3) }),
    daily: 3, premiumDaily: 50, entitlement: null,
  },
  {
    key: 'scam_risk', feature: 'scam_risk', description: 'Scam pattern check on the other person’s messages',
    system: 'You are a trust & safety assistant. Assess ONLY the messages from "Them" for romance-scam and fraud patterns (requests for money/gift cards/crypto, investment pitches, urgency, refusal to video call, moving off-platform). Be calibrated: ordinary flirting is low risk.',
    user: 'Transcript (messages from Them):\n{{transcript}}',
    vars: ['transcript'],
    schema: obj({ riskLevel: { enum: ['low', 'medium', 'high'] }, reasons: arr(str(200), 0, 5), advice: arr(str(200), 0, 4) }),
    temperature: 0, daily: 20, premiumDaily: 100,
  },
  {
    key: 'translation', feature: 'translation', description: 'Message translation',
    system: 'Translate the message faithfully into the target locale. Keep emoji and tone. Do not add commentary.',
    user: 'Target locale: {{targetLocale}}\nMessage: {{text}}',
    vars: ['targetLocale', 'text'],
    schema: obj({ translation: str(4000), detectedLanguage: str(20) }, ['translation']), temperature: 0, daily: 100, premiumDaily: 1000,
  },
  {
    key: 'date_planner', feature: 'date_planner', description: 'Date ideas grounded on catalog + context',
    system: `${TONE} Suggest safe, specific date ideas. Prefer public places for early stages, respect the budget and time, use shared interests, and include one short safety tip per idea. Prefer ideas from the provided catalog.`,
    user: 'Locale: {{locale}}\nCity: {{city}}\nDate stage: {{stage}}\nBudget: {{budget}}\nTime: {{time}}\nShared interests: {{sharedInterests}}\nCatalog ideas:\n{{catalog}}\nNotes from the user: {{notes}}',
    vars: ['locale', 'city', 'stage', 'budget', 'time', 'sharedInterests', 'catalog', 'notes'],
    schema: obj({ ideas: arr(obj({ title: str(120), description: str(400), activityType: str(50), budgetTier: { enum: ['free', 'low', 'medium', 'high'] }, durationMin: { type: 'integer', minimum: 15, maximum: 600 }, safetyTip: str(200) }), 2, 5) }),
    daily: 10, premiumDaily: 100,
  },
  {
    key: 'event_recommendation', feature: 'event_recommendation', description: 'Explain why events fit the user',
    system: `${TONE} Given candidate events and the user's interests, pick the best fits and explain each in one sentence. Only choose from the provided event ids.`,
    user: 'Locale: {{locale}}\nInterests: {{interests}}\nIntent: {{intent}}\nCandidate events (id | title | category | when):\n{{events}}',
    vars: ['locale', 'interests', 'intent', 'events'],
    schema: obj({ picks: arr(obj({ eventId: { type: 'string', pattern: '^[0-9a-f-]{36}$' }, reason: str(200) }), 0, 5) }), daily: 10, premiumDaily: 50,
  },
  {
    key: 'safety_classifier', feature: 'safety_classifier', description: 'Second-line message classification (system)',
    system: 'Classify the chat message for safety risks. Return calibrated probabilities 0-1.',
    user: 'Message: {{message}}',
    vars: ['message'],
    schema: obj({ scam: { type: 'number', minimum: 0, maximum: 1 }, harassment: { type: 'number', minimum: 0, maximum: 1 }, explicit: { type: 'number', minimum: 0, maximum: 1 }, selfHarm: { type: 'number', minimum: 0, maximum: 1 } }),
    temperature: 0, consent: null, daily: null,
  },
  {
    key: 'post_date_reflection', feature: 'post_date_reflection', description: 'Private reflection on the user’s own date feedback',
    system: `${TONE} Help the user reflect on their own private notes about a date and decide next steps. Never speculate about the other person's feelings; focus on the user's values and comfort. If the user felt unsafe, prioritise safety resources.`,
    user: 'Locale: {{locale}}\nStage: {{stage}}\nFeedback:\n{{feedback}}\nTags: {{tags}}\nNotes: {{notes}}',
    vars: ['locale', 'stage', 'feedback', 'tags', 'notes'],
    schema: obj({ reflection: str(600), nextSteps: arr(str(200), 1, 4) }), entitlement: 'ai_coach_advanced', daily: 0, premiumDaily: 20,
  },
  {
    key: 'relationship_insights', feature: 'relationship_insights', description: 'Patterns in the user’s own dating journey',
    system: `${TONE} Offer 2-4 encouraging, practical insights from the user's own aggregate dating activity. No judgement, no medical or therapy claims.`,
    user: 'Locale: {{locale}}\nActivity: {{stats}}\nJourney stages: {{journey}}\nFeedback tags: {{feedbackTags}}',
    vars: ['locale', 'stats', 'journey', 'feedbackTags'],
    schema: obj({ insights: arr(obj({ title: str(80), detail: str(300) }), 2, 4) }), entitlement: 'ai_coach_advanced', daily: 0, premiumDaily: 5,
  },
];

export async function seedAi(trx: Transaction<DB>): Promise<void> {
  for (const t of TEMPLATES) {
    let tpl = await trx.selectFrom('ai_prompt_templates').select('id').where('key', '=', t.key).executeTakeFirst();
    if (!tpl) {
      tpl = await trx.insertInto('ai_prompt_templates').values({ key: t.key, feature_key: t.feature, description: t.description }).returning('id').executeTakeFirstOrThrow();
      await trx.insertInto('ai_prompt_versions').values({
        template_id: tpl.id, version: 1, status: 'published', system_prompt: t.system, user_template: t.user, output_schema: JSON.stringify(t.schema),
        input_variables: t.vars, temperature: t.temperature ?? null, published_at: new Date(), change_note: 'Seed v1',
      }).execute();
    }
    await trx.insertInto('ai_feature_configs').values({
      feature_key: t.feature, is_enabled: false, prompt_template_id: tpl.id, temperature: t.temperature ?? 0.5, per_user_daily_limit: t.daily ?? null,
      premium_daily_limit: t.premiumDaily ?? null, requires_entitlement: t.entitlement ?? null, requires_consent: t.consent === undefined ? 'ai_assistance' : t.consent, monthly_budget_usd: 500,
    }).onConflict((oc) => oc.column('feature_key').doNothing()).execute();
  }
}
