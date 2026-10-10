import { z } from 'zod';
import { locale, uuid } from './common';

export const MESSAGE_KINDS = ['text', 'emoji', 'gif', 'image', 'voice', 'icebreaker'] as const;

export const sendMessage = z
  .object({
    clientMessageId: z.string().min(8).max(64),
    kind: z.enum(MESSAGE_KINDS),
    body: z.string().trim().min(1).max(4000).optional(),
    gifProviderId: z.string().max(200).optional(),
    /** Token returned by POST /conversations/:id/uploads after the client PUT the file. */
    uploadToken: z.string().max(1024).optional(),
    replyToId: uuid.optional(),
    /** True when the user sent an AI suggestion (always an explicit user action — MP §18). */
    aiAssisted: z.boolean().default(false),
  })
  .refine((m) => (['text', 'emoji', 'icebreaker'].includes(m.kind) ? !!m.body : true), { message: 'body required', path: ['body'] })
  .refine((m) => (m.kind === 'gif' ? !!m.gifProviderId : true), { message: 'gifProviderId required', path: ['gifProviderId'] })
  .refine((m) => (m.kind === 'image' || m.kind === 'voice' ? !!m.uploadToken : true), { message: 'uploadToken required', path: ['uploadToken'] });
export type SendMessage = z.infer<typeof sendMessage>;

export const chatUploadRequest = z.object({
  kind: z.enum(['image', 'voice']),
  mimeType: z.string().max(100),
  byteSize: z.number().int().positive(),
  durationMs: z.number().int().min(0).max(5 * 60_000).optional(),
});

export const messagesQuery = z.object({
  before: z.string().max(512).optional(), // cursor (older messages)
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const reactionRequest = z.object({ emoji: z.string().min(1).max(16) });
export const readRequest = z.object({ messageId: uuid });
export const translateRequest = z.object({ targetLocale: locale });

/** Client → server WebSocket frames. */
export const wsClientFrame = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ping') }),
  z.object({ type: z.literal('typing'), conversationId: uuid, isTyping: z.boolean() }),
  z.object({ type: z.literal('delivered'), conversationId: uuid, messageId: uuid }),
]);

/** Server → client event names. */
export const WS_EVENTS = ['ready', 'pong', 'message.new', 'message.updated', 'message.deleted', 'reaction', 'read', 'delivered', 'typing', 'match.new', 'match.ended', 'notification', 'error'] as const;

// ------------------------------------------------------------------ notifications

export const NOTIFICATION_CATEGORIES = ['match', 'message', 'like', 'ai_recommendation', 'event', 'date', 'safety', 'verification', 'subscription', 'moderation', 'system', 'marketing'] as const;
export const NOTIFICATION_CHANNELS = ['push', 'email', 'sms', 'in_app'] as const;

export const notificationPreferencesUpdate = z.object({
  preferences: z.array(z.object({ category: z.enum(NOTIFICATION_CATEGORIES), channel: z.enum(NOTIFICATION_CHANNELS), enabled: z.boolean() })).max(60),
  quietHours: z.object({ start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/), timezone: z.string().max(64) }).nullable().optional(),
});

export const pushTokenRegister = z.object({
  installationId: z.string().min(8).max(128),
  provider: z.enum(['fcm', 'apns']),
  token: z.string().min(10).max(4096),
});

export const adminTemplateCreate = z.object({
  key: z.string().regex(/^[a-z0-9_.]{2,64}$/),
  category: z.enum(NOTIFICATION_CATEGORIES),
  channels: z.array(z.enum(NOTIFICATION_CHANNELS)).min(1),
  isTransactional: z.boolean().default(true),
  respectsQuietHours: z.boolean().default(true),
  deepLinkPattern: z.string().max(300).nullable().default(null),
  isActive: z.boolean().default(true),
});

export const adminTemplateVersionInput = z.object({
  variables: z.array(z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]{0,40}$/)).max(30),
  contents: z
    .array(z.object({
      locale,
      channel: z.enum(NOTIFICATION_CHANNELS),
      title: z.string().max(200).optional(),
      subject: z.string().max(200).optional(),
      body: z.string().min(1).max(5000),
      htmlBody: z.string().max(100_000).optional(),
    }))
    .min(1),
});

/** versionId previews a specific (e.g. draft) version; omitted = the published one. */
export const adminTemplatePreview = z.object({ locale: locale.default('en'), channel: z.enum(NOTIFICATION_CHANNELS), versionId: uuid.optional(), variables: z.record(z.string(), z.union([z.string(), z.number()])).default({}) });
export const adminTemplateTestSend = z.object({ userId: uuid, variables: z.record(z.string(), z.union([z.string(), z.number()])).default({}) });
export const adminChannelConfig = z.object({
  isEnabled: z.boolean(),
  priority: z.number().int().min(0).max(100).default(0),
  settings: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
  secretRef: z.string().max(200).nullable().default(null),
  countryCodes: z.array(z.string().regex(/^[A-Z]{2}$/)).nullable().default(null),
});
export const adminBroadcast = z.object({
  templateKey: z.string().regex(/^[a-z0-9_.]{2,64}$/),
  segmentKey: z.string().regex(/^[a-z0-9_]{2,64}$/).nullable().default(null),
  countryCodes: z.array(z.string().regex(/^[A-Z]{2}$/)).nullable().default(null),
  variables: z.record(z.string(), z.union([z.string(), z.number()])).default({}),
  dryRun: z.boolean().default(true),
});
