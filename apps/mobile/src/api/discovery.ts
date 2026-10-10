import type { DistanceBucket, likeRequest, recommendationFeedbackRequest, SURFACES, travelPlanCreate } from '@amora/shared';
import type { z } from 'zod';
import { client } from './index';
import type { TermLabel } from './types';

type In<T extends z.ZodType> = z.input<T>;

// Shapes mirror apps/api/src/modules/matching/{recommendations,swipes,discovery}.service.ts and profiles.service.ts view().

export type Surface = (typeof SURFACES)[number];

export interface Photo {
  id: string;
  url: string | null;
  thumbUrl: string | null;
  width: number | null;
  height: number | null;
}

export interface Factor {
  categoryKey: string;
  score: number;
  /** `match.reason.<category>` | `match.difference.<category>` — localized on the client with `params`. */
  reasonKey: string;
  params: Record<string, string | number>;
  /** Localized compatibility-category label. */
  label: string;
}

export interface Card {
  candidateRowId: string | null;
  userId: string;
  displayName: string | null;
  age: number | null;
  city: string | null;
  distance: DistanceBucket | null;
  verified: boolean | null;
  recentlyActive: boolean | null;
  datingIntent: { key: string; label: string } | null;
  bio: string | null;
  prompt: { prompt: string | null; answer: string } | null;
  photos: Photo[];
  sharedInterests: Array<{ id: string; label: string | null }>;
  compatibility: number | null;
  confidence: number | null;
  topFactors: Factor[];
  differences: Factor[] | null;
  breakdown: Array<{ categoryKey: string; label: string; score: number }> | null;
}

export interface Feed {
  items: Card[];
  limitReached: boolean;
  resetsAt: string | null;
}

export interface LikeResult {
  action: 'like' | 'pass' | 'super_like';
  matched: boolean;
  matchId: string | null;
  conversationId: string | null;
}

export type LikesReceived =
  | { total: number; locked: true; items: []; nextCursor: null }
  | { total: number; locked: false; nextCursor: string | null; items: Array<{ likeId: string; superLike: boolean; comment: string | null; likedAt: string; profile: Card }> };

export interface MatchItem {
  matchId: string;
  conversationId: string;
  matchedAt: string;
  stage: string | null;
  compatibility: number | null;
  partner: { userId: string; displayName: string | null; age: number | null; photo: Photo | null; verified: boolean | null };
  lastMessage: { kind: string; preview: string | null; fromMe: boolean; at: string } | null;
}

export interface SearchFilters {
  ageMin?: number;
  ageMax?: number;
  maxDistanceKm?: number;
  genderIds?: string;
  intentIds?: string;
  /** Advanced (requires the advanced_filters entitlement). */
  interestIds?: string;
  languageCodes?: string;
  verifiedOnly?: boolean;
  q?: string;
}
export const ADVANCED_FILTERS = ['interestIds', 'languageCodes', 'verifiedOnly', 'heightMinCm', 'heightMaxCm', 'attributeIds', 'q'] as const;

export interface TravelPlan {
  id: string;
  cityId: string;
  cityName: string;
  countryCode: string;
  startsOn: string;
  endsOn: string;
  visibleToLocals: boolean;
  isActive: boolean;
}

export interface PublicProfile {
  id: string;
  displayName: string | null;
  age: number | null;
  bio: string | null;
  city: string | null;
  distance: DistanceBucket | null;
  gender: TermLabel | null;
  orientation: TermLabel | null;
  datingIntent: TermLabel | null;
  relationshipGoal: TermLabel | null;
  relationshipStatus: TermLabel | null;
  educationLevel: TermLabel | null;
  profession: string | null;
  employer: string | null;
  school: string | null;
  heightCm: number | null;
  verified: boolean | null;
  recentlyActive: boolean | null;
  attributes: Record<string, TermLabel[]>;
  interests: Array<{ id: string; label: string | null }>;
  prompts: Array<{ promptId: string; prompt: string | null; answer: string }>;
  media: Array<{ id: string; kind: string; position: number; url: string | null; thumbUrl: string | null; width: number | null; height: number | null; caption: string | null }>;
  matched: boolean;
  /** In the viewer's private favourites list. */
  favorited: boolean;
}

/** A profile the member liked or super-liked (GET /likes/sent). */
export interface LikeSentItem {
  likeId: string;
  superLike: boolean;
  likedAt: string;
  matched: boolean;
  matchId: string | null;
  conversationId: string | null;
  favorited: boolean;
  profile: Card;
}

/** A profile in the member's private favourites (GET /favorites). */
export interface FavoriteItem {
  favoritedAt: string;
  liked: boolean;
  matched: boolean;
  profile: Card;
}

export const discoveryApi = {
  feed: (surface: Surface, opts: { limit?: number; travelPlanId?: string; eventId?: string } = {}) => client.get<Feed>('/recommendations', { query: { surface, limit: opts.limit ?? 20, travelPlanId: opts.travelPlanId, eventId: opts.eventId } }),
  feedback: (b: In<typeof recommendationFeedbackRequest>) => client.post<void>('/recommendations/feedback', b),
  like: (b: In<typeof likeRequest>) => client.post<LikeResult>('/likes', b),
  rewind: () => client.post<{ rewoundTargetId: string; action: LikeResult['action'] }>('/likes/rewind'),
  likesReceived: (cursor?: string) => client.get<LikesReceived>('/likes/received', { query: { cursor, limit: 20 } }),
  likesSent: (cursor?: string) => client.get<{ items: LikeSentItem[]; nextCursor: string | null }>('/likes/sent', { query: { cursor, limit: 20 } }),
  favorites: (cursor?: string) => client.get<{ items: FavoriteItem[]; nextCursor: string | null }>('/favorites', { query: { cursor, limit: 20 } }),
  addFavorite: (userId: string) => client.put<void>(`/favorites/${encodeURIComponent(userId)}`),
  removeFavorite: (userId: string) => client.delete(`/favorites/${encodeURIComponent(userId)}`),
  matches: (cursor?: string) => client.get<{ items: MatchItem[]; nextCursor: string | null }>('/matches', { query: { cursor, limit: 20 } }),
  unmatch: (matchId: string) => client.post<void>(`/matches/${encodeURIComponent(matchId)}/unmatch`),
  search: (filters: SearchFilters, cursor?: string) => client.get<{ items: Card[]; nextCursor: string | null }>('/search/users', { query: { ...filters, cursor, limit: 20 } }),
  profile: (userId: string, surface = 'profile') => client.get<PublicProfile>(`/profiles/${encodeURIComponent(userId)}`, { query: { surface } }),
  travelPlans: () => client.get<TravelPlan[]>('/travel-plans'),
  createTravelPlan: (b: In<typeof travelPlanCreate>) => client.post<TravelPlan>('/travel-plans', b),
  cancelTravelPlan: (id: string) => client.delete(`/travel-plans/${encodeURIComponent(id)}`),
};
