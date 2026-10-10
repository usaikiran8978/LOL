'use client';

import Link from 'next/link';
import { ModuleIcon } from '@/components/ui/ModuleIcon';
import { t, type MessageKey } from '@/i18n';
import { useSession } from '@/lib/auth/session';
import { navFor } from '@/lib/nav';

/** Shortcuts shown in the welcome banner when the admin can open them (most common daily tasks first). */
const QUICK_ACTIONS = ['moderation', 'users', 'dashboard', 'verification'];

function greetingKey(hour: number): MessageKey {
  if (hour < 12) return 'home.greetingMorning';
  if (hour < 18) return 'home.greetingAfternoon';
  return 'home.greetingEvening';
}

export function HomePage() {
  const { admin } = useSession();
  const groups = navFor(admin?.permissions ?? [])
    .map((g) => ({ ...g, items: g.items.filter((i) => i.href && !i.planned) }))
    .filter((g) => g.items.length > 0);
  const items = groups.flatMap((g) => g.items);
  const quick = QUICK_ACTIONS.map((id) => items.find((i) => i.id === id)).filter((i) => i !== undefined).slice(0, 3);
  const name = admin?.displayName || admin?.email || '';

  return (
    <>
      <section className="home-hero" aria-labelledby="home-title">
        <p className="home-hero__eyebrow">{t(greetingKey(new Date().getHours()))}</p>
        <h1 id="home-title" className="home-hero__title">{name ? t('home.welcomeName', { name }) : t('home.title')}</h1>
        <p className="home-hero__intro">{t('home.intro')}</p>
        {quick.length ? (
          <div className="home-hero__actions">
            {quick.map((i) => (
              <Link key={i.id} href={i.href!} className="home-hero__action">
                <ModuleIcon id={i.id} size={18} />
                <span>{t(i.labelKey)}</span>
              </Link>
            ))}
          </div>
        ) : null}
        <span className="home-hero__heart" aria-hidden="true">♥</span>
      </section>

      {items.length === 0 ? (
        <div className="state state--empty">
          <p>{t('home.noneAvailable')}</p>
        </div>
      ) : (
        <>
          <div className="home-summary">
            <h2 className="home-summary__title">{t('home.available')}</h2>
            <span className="badge badge--tone-info">{t('home.moduleCount', { count: items.length })}</span>
          </div>
          {groups.map((g) => (
            <section key={g.id} className="home-group" aria-labelledby={`home-group-${g.id}`}>
              <h3 id={`home-group-${g.id}`} className="home-group__title">{t(g.labelKey)}</h3>
              <ul className="module-grid">
                {g.items.map((i) => (
                  <li key={i.id}>
                    <Link href={i.href!} className="module-card" aria-labelledby={`mod-${i.id}`} aria-describedby={`mod-${i.id}-desc`}>
                      <span className="module-card__icon"><ModuleIcon id={i.id} /></span>
                      <span className="module-card__text">
                        <span id={`mod-${i.id}`} className="module-card__title">{t(i.labelKey)}</span>
                        <span id={`mod-${i.id}-desc`} className="module-card__desc">{t(`home.modules.${i.id}` as MessageKey)}</span>
                      </span>
                      <span className="module-card__arrow" aria-hidden="true">→</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </>
  );
}
