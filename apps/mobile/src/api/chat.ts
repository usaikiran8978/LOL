import type { chatUploadRequest, sendMessage } from '@amora/shared';
import type { z } from 'zod';
import { client } from './index';

type In<T extends z.ZodType> = z.input<T>;

// Shapes mirror apps/api/src/modules/chat/chat.service.ts and calls/calls.service.ts.

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface Conversation {
  id: string;
  kind: 'match' | 'event';
  matchId: string | null;
  eventId: string | null;
  status: 'active' | 'closed';
  lastMessageAt: string | null;
  muted: boolean;
  archived: boolean;
  unreadCount: number;
  participants: Array<{ userId: string; displayName: string }>;
}

export type MessageKind = 'text' | 'emoji' | 'gif' | 'image' | 'voice' | 'icebreaker';
/** Server-generated kinds that clients cannot send (a date invitation's body is JSON: {"datePlanId": …}). */
export type ReceivedMessageKind = MessageKind | 'date_invite';

export interface Message {
  id: string;
  conversationId: string;
  senderId: string | null;
  clientMessageId: string | null;
  kind: ReceivedMessageKind;
  body: string | null;
  gifProviderId: string | null;
  media: Array<{ id: string; kind: 'image' | 'voice'; url: string | null; durationMs: number | null; width: number | null; height: number | null }>;
  replyToId: string | null;
  reactions: Array<{ emoji: string; userId: string }>;
  safetyWarning: boolean;
  aiAssisted: boolean;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
}

/** Realtime `match.ended` payload. Block and unmatch look identical on purpose (a block is never revealed). */
export interface MatchEndedEvent {
  matchId: string;
  conversationId: string | null;
}

export interface ChatUploadTicket {
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  uploadToken: string;
}

export interface Icebreaker {
  key: string;
  text: string;
}

export interface CallJoin {
  callId: string;
  /** LiveKit server URL (wss://…). */
  url: string;
  /** LiveKit access token (JWT). */
  token: string;
}

export const chatApi = {
  conversations: (cursor?: string, limit = 20) => client.get<Page<Conversation>>('/conversations', { query: { cursor, limit } }),
  /** One conversation in the list-item shape (deep links, push taps, restarts). 404 when the caller is not a member. */
  conversation: (id: string) => client.get<Conversation>(`/conversations/${encodeURIComponent(id)}`),
  /** Newest first; pass the previous page's nextCursor as `before` to load older messages. */
  messages: (id: string, before?: string, limit = 30) => client.get<Page<Message>>(`/conversations/${encodeURIComponent(id)}/messages`, { query: { before, limit } }),
  send: (id: string, b: In<typeof sendMessage>) => client.post<Message>(`/conversations/${encodeURIComponent(id)}/messages`, b),
  requestUpload: (id: string, b: In<typeof chatUploadRequest>) => client.post<ChatUploadTicket>(`/conversations/${encodeURIComponent(id)}/uploads`, b),
  markRead: (id: string, messageId: string) => client.post<void>(`/conversations/${encodeURIComponent(id)}/read`, { messageId }),
  mute: (id: string, until: string | null) => client.put<void>(`/conversations/${encodeURIComponent(id)}/mute`, { until }),
  icebreakers: (id: string) => client.get<Icebreaker[]>(`/conversations/${encodeURIComponent(id)}/icebreakers`),
  react: (messageId: string, emoji: string) => client.post<void>(`/messages/${encodeURIComponent(messageId)}/reactions`, { emoji }),
  unreact: (messageId: string, emoji: string) => client.delete(`/messages/${encodeURIComponent(messageId)}/reactions/${encodeURIComponent(emoji)}`),
  remove: (messageId: string) => client.delete(`/messages/${encodeURIComponent(messageId)}`),
};

export const callsApi = {
  start: (conversationId: string, kind: 'voice' | 'video') => client.post<CallJoin>(`/conversations/${encodeURIComponent(conversationId)}/calls`, { kind }),
  accept: (callId: string) => client.post<CallJoin>(`/calls/${encodeURIComponent(callId)}/accept`),
  decline: (callId: string) => client.post<void>(`/calls/${encodeURIComponent(callId)}/decline`),
  end: (callId: string) => client.post<void>(`/calls/${encodeURIComponent(callId)}/end`),
};
