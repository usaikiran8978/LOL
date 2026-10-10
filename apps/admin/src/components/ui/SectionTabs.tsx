'use client';

import type { Permission } from '@amora/shared';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { t } from '@/i18n';
import { useSession } from '@/lib/auth/session';

export interface SectionTab {
  href: string;
  label: string;
  /** Shown only when the admin holds at least one of these (omit = always shown). */
  anyOf?: Permission[];
  /** Match the pathname exactly instead of by prefix (for a module's index tab). */
  exact?: boolean;
}

/** Link tabs between the pages of one module, filtered by the signed-in admin's permissions. */
export function SectionTabs({ tabs, label }: { tabs: SectionTab[]; label?: string }) {
  const pathname = usePathname() ?? '/';
  const { admin } = useSession();
  const perms = admin?.permissions ?? [];
  const visible = tabs.filter((tab) => !tab.anyOf || tab.anyOf.some((p) => perms.includes(p)));
  if (visible.length < 2) return null;
  return (
    <nav aria-label={label ?? t('sections.label')} className="section-tabs">
      <ul>
        {visible.map((tab) => {
          const current = tab.exact ? pathname === tab.href : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <li key={tab.href}>
              <Link href={tab.href} className="section-tabs__link" aria-current={current ? 'page' : undefined}>{tab.label}</Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
