import { client } from './index';

// Shapes mirror apps/api/src/modules/ai/ai-features.service.ts (endpoints return the validated model output only).

export interface ProfileCoachResult {
  score: number;
  suggestions: Array<{ area: 'bio' | 'prompts' | 'photos' | 'interests' | 'details'; tip: string }>;
  bioSuggestion?: string;
}
export interface StartersResult {
  starters: string[];
  sendRequiresUserAction: true;
}
export interface TranslationResult {
  translation: string;
  detectedLanguage?: string | null;
  cached: boolean;
}
export interface InsightsResult {
  insights: Array<{ title: string; detail: string }>;
}

export const aiApi = {
  profileCoach: (focus: 'overall' | 'bio' | 'prompts' | 'photos' = 'overall') => client.post<ProfileCoachResult>('/ai/profile-coach', { focus }),
  conversationStarters: (b: { conversationId: string } | { userId: string }) => client.post<StartersResult>('/ai/conversation-starters', b),
  translate: (messageId: string, targetLocale: string) => client.post<TranslationResult>('/ai/translate', { messageId, targetLocale }),
  relationshipInsights: () => client.post<InsightsResult>('/ai/relationship-insights'),
};

/** Server flag per AI surface (apps/api/src/modules/ai/ai-features.service.ts FLAG map). */
export const AI_FLAGS = { coach: 'ai.profile_coach', insights: 'ai.profile_coach', starters: 'ai.conversation_starters', translation: 'ai.translation', datePlanner: 'ai.date_planner' } as const;
