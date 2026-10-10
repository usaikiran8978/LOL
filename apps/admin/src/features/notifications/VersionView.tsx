'use client';

import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { DefinitionList } from '@/components/ui/DefinitionList';
import { EmptyState, ErrorState, LoadingState, StatusBadge } from '@/components/ui/states';
import { t } from '@/i18n';
import type { TemplateContent, TemplateVersionDetail } from '@/lib/api/modules/notifications';
import { useAdminApi } from '@/lib/auth/session';
import { formatDateTime } from '@/lib/format';
import { useResource } from '@/lib/hooks/useResource';
import { channelLabel } from './shared';

/** Sandboxed render of an HTML e-mail body: no scripts, no same-origin access, no navigation. */
export function HtmlFrame({ html, title }: { html: string; title: string }) {
  return <iframe title={title} sandbox="" srcDoc={html} className="input" style={{ inlineSize: '100%', blockSize: '16rem' }} />;
}

function ContentCard({ c }: { c: TemplateContent }) {
  const tag = `${c.locale} · ${channelLabel(c.channel)}`;
  return (
    <section className="card" aria-label={tag}>
      <h4 className="card__title">{channelLabel(c.channel)}</h4>
      <DefinitionList
        items={[
          c.title !== null && { label: t('notifications.versions.title'), value: <span className="pre-wrap" dir="auto">{c.title}</span> },
          c.subject !== null && { label: t('notifications.versions.subject'), value: <span className="pre-wrap" dir="auto">{c.subject}</span> },
          { label: t('notifications.versions.body'), value: <span className="pre-wrap" dir="auto">{c.body}</span> },
        ]}
      />
      {c.html_body ? <HtmlFrame html={c.html_body} title={t('notifications.versions.htmlFrame', { tag })} /> : null}
    </section>
  );
}

/** Contents of one version grouped by locale (ARIA tabs) with a card per channel. */
function LocaleTabs({ contents }: { contents: TemplateContent[] }) {
  const baseId = useId();
  const locales = [...new Set(contents.map((c) => c.locale))].sort((a, b) => (a === 'en' ? -1 : b === 'en' ? 1 : a.localeCompare(b)));
  const [active, setActive] = useState(locales[0] ?? 'en');
  const current = locales.includes(active) ? active : (locales[0] ?? 'en');
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  function onKey(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = locales[(i + delta + locales.length) % locales.length]!;
    setActive(next);
    refs.current[next]?.focus();
  }

  if (locales.length === 0) return <EmptyState message={t('notifications.versions.noContents')} />;
  return (
    <>
      <div role="tablist" aria-label={t('notifications.versions.localesLabel')} className="tabs">
        {locales.map((loc, i) => (
          <button
            key={loc}
            ref={(el) => { refs.current[loc] = el; }}
            type="button"
            role="tab"
            id={`${baseId}-tab-${loc}`}
            aria-selected={loc === current}
            aria-controls={`${baseId}-panel`}
            tabIndex={loc === current ? 0 : -1}
            className="tab"
            onClick={() => setActive(loc)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {loc}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${baseId}-panel`} aria-labelledby={`${baseId}-tab-${current}`} className="grid grid--2">
        {contents.filter((c) => c.locale === current).map((c) => <ContentCard key={`${c.locale}-${c.channel}`} c={c} />)}
      </div>
    </>
  );
}

export function VersionView({ templateKey, version, onCopy }: { templateKey: string; version: number; onCopy: (v: TemplateVersionDetail) => void }) {
  const api = useAdminApi();
  const detail = useResource(() => api.notifications.version(templateKey, version), [api, templateKey, version]);

  return (
    <section className="card stack" aria-labelledby="version-view-title">
      <div className="toolbar">
        <h3 id="version-view-title" className="card__title">{t('notifications.versions.viewTitle', { version })}</h3>
        {detail.status === 'success' ? (
          <div className="toolbar__end">
            <Button variant="secondary" size="sm" onClick={() => onCopy(detail.data)}>{t('notifications.versions.copy')}</Button>
          </div>
        ) : null}
      </div>
      {detail.status === 'loading' ? <LoadingState /> : null}
      {detail.status === 'error' ? <ErrorState error={detail.error} onRetry={detail.reload} /> : null}
      {detail.status === 'success' ? (
        <>
          <DefinitionList
            items={[
              { label: t('common.status'), value: <StatusBadge status={detail.data.status} /> },
              { label: t('notifications.versions.variables'), value: detail.data.variables.length ? detail.data.variables.map((v) => <code key={v}>{`{{${v}}}`} </code>) : t('common.none') },
              { label: t('notifications.versions.createdAt'), value: formatDateTime(detail.data.created_at) },
              { label: t('notifications.versions.publishedAt'), value: formatDateTime(detail.data.published_at) },
            ]}
          />
          <p className="muted">{t('notifications.versions.immutable')}</p>
          <LocaleTabs contents={detail.data.contents} />
        </>
      ) : null}
    </section>
  );
}
