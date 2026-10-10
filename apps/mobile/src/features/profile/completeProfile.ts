import type { Href } from 'expo-router';
import type { OwnProfile } from '../../api';

/**
 * Where "Complete profile" leads. Until onboarding is finished that is the original guided flow; afterwards, the first
 * section still missing points (mirrors the server's completeness weights in profile-state.service.ts).
 */
export function completeProfileHref(p: OwnProfile, onboardingCompleted: boolean): Href {
  if (!onboardingCompleted) return '/onboarding';
  const photos = p.media.filter((m) => m.kind === 'photo').length;
  if (photos < 3) return '/profile/media';
  if (!p.displayName || !p.bio || !(p.profession || p.employer)) return '/profile/edit';
  if (!p.gender || !p.datingIntent || !p.relationshipGoal) return '/profile/identity';
  if (p.interestIds.length < 3) return '/profile/interests';
  if (p.prompts.length < 1) return '/profile/prompts';
  if (p.languages.length < 1) return '/profile/languages';
  if (Object.values(p.attributes).flat().length < 3) return '/profile/attributes';
  return '/questionnaire';
}
