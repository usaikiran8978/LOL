'use client';

import { NOTIFICATION_CATEGORIES, NOTIFICATION_CHANNELS } from '@amora/shared';
import { SectionTabs } from '@/components/ui/SectionTabs';
import { t } from '@/i18n';
import type { NotificationCategory, NotificationChannel } from '@/lib/api/modules/notifications';

export const CHANNELS = NOTIFICATION_CHANNELS;
export const CATEGORIES = NOTIFICATION_CATEGORIES;

export const channelLabel = (c: NotificationChannel) => t(`notifications.channel.${c}`);
export const categoryLabel = (c: NotificationCategory) => t(`notifications.category.${c}`);

/** Which content fields each channel uses (mirrors how NotificationsService delivers them). */
export const CHANNEL_FIELDS: Record<NotificationChannel, { title: boolean; subject: boolean; html: boolean }> = {
  push: { title: true, subject: false, html: false },
  in_app: { title: true, subject: false, html: false },
  email: { title: false, subject: true, html: true },
  sms: { title: false, subject: false, html: false },
};

// Same token grammar as apps/api/src/modules/notifications/render.ts (`{{name}}` placeholders only).
const TOKEN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

export function placeholders(text: string | null | undefined): string[] {
  if (!text) return [];
  return [...new Set([...text.matchAll(TOKEN)].map((m) => m[1]!))];
}

/** Placeholders used by the given texts but missing from `declared` (the API rejects such versions). */
export function undeclaredVariables(texts: Array<string | null | undefined>, declared: string[]): string[] {
  const used = new Set(texts.flatMap(placeholders));
  return [...used].filter((u) => !declared.includes(u));
}

export function NotificationsTabs() {
  return (
    <SectionTabs
      label={t('notifications.tabsLabel')}
      tabs={[
        { href: '/notifications', label: t('notifications.tabs.templates'), anyOf: ['notifications.manage'], exact: true },
        { href: '/notifications/channels', label: t('notifications.tabs.channels'), anyOf: ['notifications.channels'] },
        { href: '/notifications/broadcast', label: t('notifications.tabs.broadcast'), anyOf: ['notifications.broadcast'] },
      ]}
    />
  );
}
