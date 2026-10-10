'use client';

import type { Permission } from '@amora/shared';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { t } from '@/i18n';
import { canSee, routeItem } from '@/lib/nav';

/** Route-level permission check (the API enforces the same permissions; this avoids rendering dead pages). */
export function RouteGuard({ pathname, permissions, children }: { pathname: string; permissions: readonly Permission[]; children: ReactNode }) {
  const item = routeItem(pathname);
  if (item && !canSee(item, permissions)) return <Forbidden permission={item.anyOf.join(' / ')} />;
  return <>{children}</>;
}

/** Page-level guard for components rendered outside the nav routing (also used directly in tests). */
export function RequirePermission({ permission, permissions, children }: { permission: Permission; permissions: readonly Permission[]; children: ReactNode }) {
  if (!permissions.includes(permission)) return <Forbidden permission={permission} />;
  return <>{children}</>;
}

export function Forbidden({ permission }: { permission: string }) {
  return (
    <div className="state state--error" role="alert">
      <h1 className="state__title">{t('states.forbiddenTitle')}</h1>
      <p>{t('states.forbiddenBody', { permission })}</p>
      <Link href="/">{t('states.backHome')}</Link>
    </div>
  );
}
