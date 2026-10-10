'use client';

import { Forbidden } from '@/components/shell/RouteGuard';
import { useSession } from '@/lib/auth/session';
import { BroadcastPage } from './BroadcastPage';
import { ChannelsPage } from './ChannelsPage';
import { TemplatesPage } from './TemplatesPage';

/**
 * `/notifications` entry: the nav item is visible with notifications.manage OR notifications.channels, so an
 * admin without template access lands on the first section they can use instead of a dead end.
 */
export function NotificationsHome() {
  const { can } = useSession();
  if (can('notifications.manage')) return <TemplatesPage />;
  if (can('notifications.channels')) return <ChannelsPage />;
  if (can('notifications.broadcast')) return <BroadcastPage />;
  return <Forbidden permission="notifications.manage / notifications.channels" />;
}
