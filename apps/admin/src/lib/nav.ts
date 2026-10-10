import type { Permission } from '@amora/shared';
import type { MessageKey } from '@/i18n';

export interface NavItem {
  id: string;
  labelKey: MessageKey;
  /** The admin needs at least one of these permissions to see the item or open the route. */
  anyOf: Permission[];
  /** Planned modules have no route yet; they render as disabled, clearly labelled entries. */
  href?: string;
  planned?: boolean;
}

export interface NavGroup {
  id: string;
  labelKey: MessageKey;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    id: 'overview',
    labelKey: 'nav.groups.overview',
    items: [
      { id: 'dashboard', labelKey: 'nav.items.dashboard', anyOf: ['dashboard.view'], href: '/dashboard' },
      { id: 'analytics', labelKey: 'nav.items.analytics', anyOf: ['analytics.view'], href: '/analytics' },
    ],
  },
  {
    id: 'operations',
    labelKey: 'nav.groups.operations',
    items: [
      { id: 'users', labelKey: 'nav.items.users', anyOf: ['users.view'], href: '/users' },
      { id: 'moderation', labelKey: 'nav.items.moderation', anyOf: ['moderation.view', 'moderation.appeals', 'moderation.rules.manage', 'profiles.review'], href: '/moderation' },
      { id: 'verification', labelKey: 'nav.items.verification', anyOf: ['verification.view'], href: '/verification' },
      { id: 'privacy', labelKey: 'nav.items.privacy', anyOf: ['privacy.requests', 'privacy.retention.manage'], href: '/privacy' },
      { id: 'billing', labelKey: 'nav.items.billing', anyOf: ['billing.view', 'billing.plans.manage', 'billing.coupons.manage'], href: '/billing' },
    ],
  },
  {
    id: 'product',
    labelKey: 'nav.groups.product',
    items: [
      { id: 'onboarding', labelKey: 'nav.items.onboarding', anyOf: ['onboarding.manage'], href: '/onboarding' },
      { id: 'questionnaire', labelKey: 'nav.items.questionnaire', anyOf: ['questions.view'], href: '/questionnaire' },
      { id: 'matching', labelKey: 'nav.items.matching', anyOf: ['matching.view', 'matching.test'], href: '/matching' },
      { id: 'ai', labelKey: 'nav.items.ai', anyOf: ['ai.view'], href: '/ai' },
      { id: 'experiments', labelKey: 'nav.items.experiments', anyOf: ['analytics.view'], href: '/experiments' },
    ],
  },
  {
    id: 'catalog',
    labelKey: 'nav.groups.catalog',
    items: [
      { id: 'taxonomy', labelKey: 'nav.items.taxonomy', anyOf: ['taxonomy.manage'], href: '/taxonomy' },
      { id: 'interests', labelKey: 'nav.items.interests', anyOf: ['taxonomy.manage'], href: '/interests' },
      { id: 'prompts', labelKey: 'nav.items.prompts', anyOf: ['taxonomy.manage'], href: '/prompts' },
    ],
  },
  {
    id: 'geography',
    labelKey: 'nav.groups.geography',
    items: [
      { id: 'countries', labelKey: 'nav.items.countries', anyOf: ['geo.manage'], href: '/geo/countries' },
      { id: 'cities', labelKey: 'nav.items.cities', anyOf: ['geo.manage'], href: '/geo/cities' },
      { id: 'languages', labelKey: 'nav.items.languages', anyOf: ['geo.manage'], href: '/geo/languages' },
    ],
  },
  {
    id: 'platform',
    labelKey: 'nav.groups.platform',
    items: [
      { id: 'flags', labelKey: 'nav.items.flags', anyOf: ['flags.manage'], href: '/config/flags' },
      { id: 'segments', labelKey: 'nav.items.segments', anyOf: ['flags.manage'], href: '/config/segments' },
      { id: 'settings', labelKey: 'nav.items.settings', anyOf: ['settings.manage'], href: '/config/settings' },
    ],
  },
  {
    id: 'content',
    labelKey: 'nav.groups.content',
    items: [
      { id: 'cms', labelKey: 'nav.items.cms', anyOf: ['cms.manage'], href: '/content/cms' },
      { id: 'legal', labelKey: 'nav.items.legal', anyOf: ['legal.manage'], href: '/content/legal' },
      { id: 'notifications', labelKey: 'nav.items.notifications', anyOf: ['notifications.manage', 'notifications.channels'], href: '/notifications' },
      { id: 'events', labelKey: 'nav.items.events', anyOf: ['events.view'], href: '/events' },
      { id: 'dates', labelKey: 'nav.items.dates', anyOf: ['date_safety.manage'], href: '/dates' },
    ],
  },
  {
    id: 'security',
    labelKey: 'nav.groups.security',
    items: [
      { id: 'admins', labelKey: 'nav.items.admins', anyOf: ['admins.manage'], href: '/admins' },
      { id: 'audit', labelKey: 'nav.items.audit', anyOf: ['audit.view'], href: '/audit-logs' },
    ],
  },
];

export function canSee(item: Pick<NavItem, 'anyOf'>, permissions: readonly Permission[]): boolean {
  return item.anyOf.some((p) => permissions.includes(p));
}

/** Navigation filtered to what the admin may access; groups left empty are dropped. */
export function navFor(permissions: readonly Permission[], nav: NavGroup[] = NAV): NavGroup[] {
  return nav
    .map((g) => ({ ...g, items: g.items.filter((i) => canSee(i, permissions)) }))
    .filter((g) => g.items.length > 0);
}

/** The nav item owning a pathname (longest matching href), used by the route guard. */
export function routeItem(pathname: string, nav: NavGroup[] = NAV): NavItem | undefined {
  let best: NavItem | undefined;
  for (const item of nav.flatMap((g) => g.items)) {
    if (!item.href) continue;
    if ((pathname === item.href || pathname.startsWith(`${item.href}/`)) && (!best || item.href.length > best.href!.length)) best = item;
  }
  return best;
}
