import type { NOTIFICATION_CATEGORIES, NOTIFICATION_CHANNELS, notificationPreferencesUpdate, pushTokenRegister } from '@amora/shared';
import type { z } from 'zod';
import { client } from './index';

type In<T extends z.ZodType> = z.input<T>;

// Shapes mirror apps/api/src/modules/notifications/notifications.service.ts.

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export interface InboxItem {
  id: string;
  category: NotificationCategory;
  title: string | null;
  body: string | null;
  deepLink: string | null;
  read: boolean;
  createdAt: string;
}

export interface Inbox {
  unread: number;
  items: InboxItem[];
  nextCursor: string | null;
}

export interface QuietHours {
  start: string;
  end: string;
  timezone: string | null;
}

export interface NotificationPreferences {
  preferences: Array<{ category: NotificationCategory; channel: NotificationChannel; enabled: boolean; locked: boolean }>;
  quietHours: QuietHours | null;
}

export const notificationsApi = {
  inbox: (cursor?: string, limit = 20) => client.get<Inbox>('/notifications', { query: { cursor, limit } }),
  markRead: (id: string) => client.post<void>(`/notifications/${encodeURIComponent(id)}/read`),
  markAllRead: () => client.post<void>('/notifications/read-all'),
  preferences: () => client.get<NotificationPreferences>('/notifications/preferences'),
  updatePreferences: (b: In<typeof notificationPreferencesUpdate>) => client.put<NotificationPreferences>('/notifications/preferences', b),
  registerPushToken: (b: In<typeof pushTokenRegister>) => client.post<void>('/devices/push-token', b),
};
