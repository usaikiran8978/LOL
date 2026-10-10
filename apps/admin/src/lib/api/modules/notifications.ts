import type { adminBroadcast, adminChannelConfig, adminTemplateCreate, adminTemplatePreview, adminTemplateTestSend, adminTemplateVersionInput, NOTIFICATION_CATEGORIES, NOTIFICATION_CHANNELS } from '@amora/shared';
import type { z } from 'zod';
import type { ApiClient } from '../client';

type In<T extends z.ZodType> = z.input<T>;
const enc = encodeURIComponent;

/*
 * Response shapes mirror apps/api/src/modules/notifications/notifications.controller.ts (rows returned as-is,
 * snake_case columns); `@amora/shared` only defines the request contracts.
 */

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];
/** Channels that have provider configuration (in-app delivery has no external provider). */
export type ProviderChannel = Exclude<NotificationChannel, 'in_app'>;
export type TemplateVersionStatus = 'draft' | 'published' | 'archived';

export interface TemplateVersionSummary {
  id: string;
  template_id: string;
  version: number;
  status: TemplateVersionStatus;
  published_at: string | null;
}

export interface NotificationTemplate {
  id: string;
  key: string;
  category: NotificationCategory;
  channels: NotificationChannel[];
  is_transactional: boolean;
  respects_quiet_hours: boolean;
  deep_link_pattern: string | null;
  is_active: boolean;
  created_at: string;
  /** Newest first. */
  versions: TemplateVersionSummary[];
}

export interface TemplateContent {
  version_id: string;
  locale: string;
  channel: NotificationChannel;
  title: string | null;
  subject: string | null;
  body: string;
  html_body: string | null;
}

export interface TemplateVersionDetail {
  id: string;
  template_id: string;
  version: number;
  status: TemplateVersionStatus;
  variables: string[];
  created_by: string | null;
  created_at: string;
  published_at: string | null;
  published_by: string | null;
  contents: TemplateContent[];
}

/** Rendered from the template's PUBLISHED version; `locale` is the locale actually used after fallback. */
export interface TemplatePreview {
  locale: string;
  versionId: string;
  title: string | null;
  subject: string | null;
  body: string;
  htmlBody: string | null;
}

export interface ChannelConfigRow {
  channel: ProviderChannel;
  provider: string;
  is_enabled: boolean;
  priority: number;
  settings: Record<string, string | number | boolean>;
  /** Secrets-manager key. Never rendered by the console (write-only input). */
  secret_ref: string | null;
  country_codes: string[] | null;
  updated_by: string | null;
  updated_at: string;
}

export type BroadcastResult = { dryRun: true; audienceUpperBound: number } | { dryRun: false; queued: number };

/** Typed wrappers for the notifications admin endpoints. */
export function notificationsApi(c: ApiClient) {
  return {
    templates: () => c.get<NotificationTemplate[]>('/admin/notifications/templates'),
    upsertTemplate: (body: In<typeof adminTemplateCreate>) => c.put<Omit<NotificationTemplate, 'versions'>>(`/admin/notifications/templates/${enc(body.key)}`, body),
    version: (key: string, version: number) => c.get<TemplateVersionDetail>(`/admin/notifications/templates/${enc(key)}/versions/${version}`),
    createVersion: (key: string, body: In<typeof adminTemplateVersionInput>) => c.post<{ id: string; version: number }>(`/admin/notifications/templates/${enc(key)}/versions`, body),
    publishVersion: (key: string, version: number) => c.post<{ id: string; version: number; status: TemplateVersionStatus }>(`/admin/notifications/templates/${enc(key)}/versions/${version}/publish`),
    preview: (key: string, body: In<typeof adminTemplatePreview>) => c.post<TemplatePreview>(`/admin/notifications/templates/${enc(key)}/preview`, body),
    testSend: (key: string, body: In<typeof adminTemplateTestSend>) => c.post<{ created: number }>(`/admin/notifications/templates/${enc(key)}/test-send`, body),
    channels: () => c.get<ChannelConfigRow[]>('/admin/notifications/channels'),
    upsertChannel: (channel: ProviderChannel, provider: string, body: In<typeof adminChannelConfig>) =>
      c.put<ChannelConfigRow>(`/admin/notifications/channels/${enc(channel)}/${enc(provider)}`, body),
    broadcast: (body: In<typeof adminBroadcast>) => c.post<BroadcastResult>('/admin/notifications/broadcast', body),
  };
}
