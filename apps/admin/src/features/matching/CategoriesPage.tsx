'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { BoolBadge, EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui/states';
import { t, tDynamic } from '@/i18n';
import type { CompatibilityCategoryRow } from '@/lib/api/modules/matching';
import { useAdminApi, useSession } from '@/lib/auth/session';
import { useResource } from '@/lib/hooks/useResource';
import { CategoryDialog, SignalsDialog } from './CategoryDialogs';
import { categoryLabel, MatchingTabs } from './shared';

/** Compatibility categories (what the score is broken down into) and the profile signals feeding each one. */
export function CategoriesPage() {
  const api = useAdminApi();
  const { can } = useSession();
  const categories = useResource(() => api.matching.categories(), [api]);
  const [editing, setEditing] = useState<CompatibilityCategoryRow | 'new' | null>(null);
  const [signals, setSignals] = useState<CompatibilityCategoryRow | null>(null);
  const canEdit = can('matching.edit');

  return (
    <>
      <PageHeader
        title={t('matching.categories.title')}
        intro={t('matching.categories.intro')}
        actions={canEdit ? <Button onClick={() => setEditing('new')}>{t('matching.categories.new')}</Button> : null}
      />
      <MatchingTabs />
      {categories.status === 'loading' ? <LoadingState /> : null}
      {categories.status === 'error' ? <ErrorState error={categories.error} onRetry={categories.reload} /> : null}
      {categories.status === 'success' && categories.data.length === 0 ? <EmptyState message={t('matching.categories.empty')} /> : null}
      {categories.status === 'success' && categories.data.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('matching.categories.category')}</th>
                <th scope="col">{t('matching.categories.source')}</th>
                <th scope="col">{t('common.position')}</th>
                <th scope="col">{t('common.status')}</th>
                <th scope="col">{t('matching.categories.signals')}</th>
                <th scope="col">{t('matching.categories.inOverall')}</th>
                <th scope="col"><span className="visually-hidden">{t('common.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {categories.data.map((c) => (
                <tr key={c.id}>
                  <td>{categoryLabel(c, c.key)} <code>{c.key}</code></td>
                  <td>{tDynamic(`matching.source.${c.source}`, c.source)}</td>
                  <td className="num">{c.position}</td>
                  <td><BoolBadge value={c.is_active} on={t('common.active')} off={t('common.inactive')} /></td>
                  <td>
                    <SignalSummary row={c} />
                  </td>
                  <td><BoolBadge value={c.in_overall} /></td>
                  <td className="table__actions">
                    {canEdit ? (
                      <>
                        <Button variant="ghost" size="sm" onClick={() => setEditing(c)} aria-label={`${t('common.edit')} ${c.key}`}>{t('common.edit')}</Button>
                        <Button variant="ghost" size="sm" onClick={() => setSignals(c)} aria-label={`${t('matching.categories.editSignals')} ${c.key}`}>{t('matching.categories.editSignals')}</Button>
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {editing ? <CategoryDialog category={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={categories.reload} /> : null}
      {signals ? <SignalsDialog category={signals} onClose={() => setSignals(null)} onSaved={categories.reload} /> : null}
    </>
  );
}

function SignalSummary({ row }: { row: CompatibilityCategoryRow }) {
  const parts = [
    ...row.attribute_kinds,
    ...(row.uses_intent ? [t('matching.signals.usesIntent')] : []),
    ...(row.uses_interests ? [t('matching.signals.usesInterests')] : []),
    ...(row.uses_location ? [t('matching.signals.usesLocation')] : []),
  ];
  return parts.length ? <span>{parts.join(', ')}</span> : <span className="muted">{t('matching.signals.none')}</span>;
}
