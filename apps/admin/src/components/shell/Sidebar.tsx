'use client';

import type { Permission } from '@amora/shared';
import Link from 'next/link';
import { ModuleIcon } from '@/components/ui/ModuleIcon';
import { t } from '@/i18n';
import { NAV, navFor, type NavGroup } from '@/lib/nav';

export function Sidebar({ permissions, pathname, nav = NAV }: { permissions: readonly Permission[]; pathname: string; nav?: NavGroup[] }) {
  const groups = navFor(permissions, nav);
  return (
    <nav aria-label={t('nav.label')} className="sidebar">
      <ul className="nav">
        <li>
          <Link href="/" className="nav__link nav__link--icon" aria-current={pathname === '/' ? 'page' : undefined}><ModuleIcon id="home" size={18} /><span>{t('nav.home')}</span></Link>
        </li>
      </ul>
      {groups.map((g) => (
        <section key={g.id} aria-labelledby={`nav-${g.id}`} className="nav__group">
          <h2 id={`nav-${g.id}`} className="nav__group-title">{t(g.labelKey)}</h2>
          <ul className="nav">
            {g.items.map((item) => {
              if (item.planned || !item.href) {
                // Not a link: there is no page behind it. Kept focus-free so keyboard users skip it.
                return (
                  <li key={item.id}>
                    <span className="nav__link nav__link--planned" aria-disabled="true">
                      <span>{t(item.labelKey)}</span>
                      <span className="badge badge--planned">{t('nav.planned')}</span>
                    </span>
                  </li>
                );
              }
              const current = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <li key={item.id}>
                  <Link href={item.href} className="nav__link nav__link--icon" aria-current={current ? 'page' : undefined}><ModuleIcon id={item.id} size={18} /><span>{t(item.labelKey)}</span></Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </nav>
  );
}
