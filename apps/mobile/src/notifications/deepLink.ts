import type { Href } from 'expo-router';

/**
 * Server deep links look like `<scheme>://chat/<conversationId>`, `://matches/<id>`, `://likes`,
 * `://settings/subscription`, `://settings/privacy`, `://settings/verification`. Unknown links open nothing.
 */
export function routeForDeepLink(link: string | null | undefined): Href | null {
  if (!link) return null;
  const path = link.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^\/+/, '').split('?')[0]!;
  const [head, id] = path.split('/');
  switch (head) {
    case 'chat':
    case 'chats':
      return id ? { pathname: '/chats/[id]', params: { id } } : '/chats';
    case 'matches':
      return '/matches';
    case 'likes':
      return '/discover/likes';
    case 'events':
      return id ? { pathname: '/events/[id]', params: { id } } : '/events';
    case 'settings':
      if (id === 'subscription') return '/premium';
      if (id === 'privacy') return '/settings/data';
      if (id === 'verification') return '/safety/verification';
      return '/settings';
    case 'safety':
      return id === 'sessions' ? '/safety/date' : '/safety';
    case 'notifications':
      return '/notifications';
    default:
      return null;
  }
}
