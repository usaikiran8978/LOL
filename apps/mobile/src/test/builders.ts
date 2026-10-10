/* Response builders for the newer feature areas. Shapes match src/api/*.ts (which mirror the API services). */
import type { Question } from '../api/questionnaire';
import type { Card, MatchItem } from '../api/discovery';
import type { Conversation, Message } from '../api/chat';

export const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const question = (over: Partial<Question> = {}): Question => ({
  questionId: uuid(101),
  key: 'kids',
  categoryKey: 'family',
  versionId: uuid(201),
  answerType: 'single_choice',
  text: 'Do you want children?',
  helpText: null,
  scaleMinLabel: null,
  scaleMaxLabel: null,
  isRequired: false,
  allowImportance: true,
  allowDealbreaker: true,
  allowSkip: true,
  constraints: { minSelections: null, maxSelections: null, scaleMin: null, scaleMax: null, scaleStep: null, numericMin: null, numericMax: null, numericUnit: null, textMaxLength: null },
  options: [
    { key: 'want', label: 'Want', isExclusive: false },
    { key: 'open', label: 'Open', isExclusive: false },
    { key: 'dont_want', label: "Don't want", isExclusive: false },
  ],
  answer: null,
  needsReanswer: false,
  ...over,
});

export const card = (over: Partial<Card> = {}): Card => ({
  candidateRowId: uuid(301),
  userId: uuid(401),
  displayName: 'Alex',
  age: 31,
  city: 'London',
  distance: '2_5km',
  verified: true,
  recentlyActive: true,
  datingIntent: { key: 'long_term', label: 'Long-term' },
  bio: 'Runner and bookworm.',
  prompt: { prompt: 'My ideal Sunday', answer: 'Parkrun then brunch' },
  photos: [{ id: uuid(501), url: 'https://cdn.test/p1', thumbUrl: 'https://cdn.test/p1t', width: 600, height: 800 }],
  sharedInterests: [{ id: uuid(601), label: 'Hiking' }],
  compatibility: 87,
  confidence: 0.8,
  topFactors: [{ categoryKey: 'values', score: 92, reasonKey: 'match.reason.values', params: { agreedAnswers: 4 }, label: 'Values' }],
  differences: [{ categoryKey: 'lifestyle', score: 40, reasonKey: 'match.difference.lifestyle', params: {}, label: 'Lifestyle' }],
  breakdown: null,
  ...over,
});

export const matchItem = (over: Partial<MatchItem> = {}): MatchItem => ({
  matchId: uuid(701),
  conversationId: uuid(801),
  matchedAt: '2026-10-01T10:00:00.000Z',
  stage: 'matched',
  compatibility: 87,
  partner: { userId: uuid(401), displayName: 'Alex', age: 31, photo: null, verified: true },
  lastMessage: { kind: 'text', preview: 'Hey there', fromMe: false, at: '2026-10-07T10:00:00.000Z' },
  ...over,
});

export const conversation = (over: Partial<Conversation> = {}): Conversation => ({
  id: uuid(801),
  kind: 'match',
  matchId: uuid(701),
  eventId: null,
  status: 'active',
  lastMessageAt: '2026-10-07T10:00:00.000Z',
  muted: false,
  archived: false,
  unreadCount: 2,
  participants: [{ userId: uuid(401), displayName: 'Alex' }],
  ...over,
});

export const message = (over: Partial<Message> = {}): Message => ({
  id: uuid(901),
  conversationId: uuid(801),
  senderId: uuid(401),
  clientMessageId: null,
  kind: 'text',
  body: 'Hey there',
  gifProviderId: null,
  media: [],
  replyToId: null,
  reactions: [],
  safetyWarning: false,
  aiAssisted: false,
  createdAt: '2026-10-07T10:00:00.000Z',
  editedAt: null,
  deleted: false,
  ...over,
});
