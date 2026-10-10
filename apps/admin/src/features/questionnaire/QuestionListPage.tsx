'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { SelectField, TextField } from '@/components/ui/fields';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui/states';
import { t } from '@/i18n';
import type { QuestionListStatus } from '@/lib/api/modules/questionnaire';
import { useAdminApi, useSession } from '@/lib/auth/session';
import { formatNumber } from '@/lib/format';
import { useResource } from '@/lib/hooks/useResource';
import { ReorderDialog } from './ReorderDialog';
import { answerTypeLabel, categoryName, labelOf, QuestionnaireTabs, QuestionStateBadge } from './shared';

const STATUSES: QuestionListStatus[] = ['active', 'inactive', 'draft_only', 'archived'];

/** All questions with server-side category/status filters and a local text search (the API has no search). */
export function QuestionListPage() {
  const api = useAdminApi();
  const { can } = useSession();
  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus] = useState<QuestionListStatus | ''>('');
  const [search, setSearch] = useState('');
  const [reordering, setReordering] = useState(false);
  const categories = useResource(() => api.questionnaire.categories(), [api]);
  const list = useResource(() => api.questionnaire.list({ categoryId: categoryId || undefined, status: status || undefined }), [api, categoryId, status]);

  const cats = categories.data ?? [];
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const catPos = new Map((categories.data ?? []).map((c) => [c.id, c.position]));
    return (list.data ?? [])
      .filter((r) => !q || r.key.toLowerCase().includes(q) || (r.text ?? '').toLowerCase().includes(q))
      .sort((a, b) => (catPos.get(a.category_id) ?? 0) - (catPos.get(b.category_id) ?? 0) || a.category_id.localeCompare(b.category_id) || a.position - b.position);
  }, [list.data, categories.data, search]);
  const selectedCategory = cats.find((c) => c.id === categoryId);

  return (
    <>
      <PageHeader
        title={t('questionnaire.title')}
        intro={t('questionnaire.intro')}
        actions={can('questions.edit') ? <Link className="btn btn--primary btn--md" href="/questionnaire/new">{t('questionnaire.list.newQuestion')}</Link> : null}
      />
      <QuestionnaireTabs />
      <div className="filters">
        <SelectField
          label={t('questionnaire.list.category')}
          value={categoryId}
          onChange={setCategoryId}
          options={cats.map((c) => ({ value: c.id, label: labelOf(c) }))}
          placeholder={t('common.all')}
          disabled={categories.status !== 'success'}
          className="field--inline"
        />
        <SelectField
          label={t('common.status')}
          value={status}
          onChange={(v) => setStatus(v as QuestionListStatus | '')}
          options={STATUSES.map((s) => ({ value: s, label: t(`questionnaire.list.statuses.${s}`) }))}
          placeholder={t('questionnaire.list.allCurrent')}
          className="field--inline"
        />
        <TextField type="search" label={t('questionnaire.list.search')} value={search} onChange={setSearch} className="field--inline" />
        {can('questions.edit') ? (
          <Button
            variant="secondary"
            onClick={() => setReordering(true)}
            disabled={!selectedCategory || status === 'archived'}
            title={!selectedCategory ? t('questionnaire.reorder.pickCategory') : undefined}
          >
            {t('questionnaire.reorder.action')}
          </Button>
        ) : null}
      </div>
      {can('questions.edit') && !selectedCategory ? <p className="field__hint">{t('questionnaire.reorder.pickCategory')}</p> : null}

      {list.status === 'loading' ? <LoadingState /> : null}
      {list.status === 'error' ? <ErrorState error={list.error} onRetry={list.reload} /> : null}
      {categories.status === 'error' ? <ErrorState error={categories.error} onRetry={categories.reload} title={t('questionnaire.categories.loadFailed')} /> : null}
      {list.status === 'success' && rows.length === 0 ? <EmptyState message={list.data.length ? t('common.noResults') : t('questionnaire.list.empty')} /> : null}
      {list.status === 'success' && rows.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('questionnaire.list.category')}</th>
                <th scope="col" className="num">{t('common.position')}</th>
                <th scope="col">{t('common.key')}</th>
                <th scope="col">{t('questionnaire.editor.text')}</th>
                <th scope="col">{t('questionnaire.editor.answerType')}</th>
                <th scope="col">{t('common.status')}</th>
                <th scope="col">{t('questionnaire.list.versions')}</th>
                <th scope="col" className="num">{t('questionnaire.editor.weight')}</th>
                <th scope="col" className="num">{t('questionnaire.list.answers')}</th>
                <th scope="col"><span className="visually-hidden">{t('common.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{categoryName(cats, r.category_id)}</td>
                  <td className="num">{formatNumber(r.position)}</td>
                  <td><code>{r.key}</code></td>
                  <td dir="auto">{r.text ?? <span className="muted">{t('questionnaire.list.noPublishedText')}</span>}</td>
                  <td>{answerTypeLabel(r.answer_type)}</td>
                  <td><QuestionStateBadge row={r} /></td>
                  <td>
                    {r.published_version !== null ? t('questionnaire.list.publishedV', { version: r.published_version }) : '—'}
                    {r.draft_version !== null ? <> · {t('questionnaire.list.draftV', { version: r.draft_version })}</> : null}
                  </td>
                  <td className="num">{formatNumber(r.weight)}</td>
                  <td className="num">{formatNumber(r.current_answers)}</td>
                  <td className="table__actions">
                    <Link href={`/questionnaire/${encodeURIComponent(r.id)}`} aria-label={`${t('common.view')} ${r.key}`}>{t('common.view')}</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {reordering && selectedCategory ? <ReorderDialog category={selectedCategory} onClose={() => setReordering(false)} onSaved={list.reload} /> : null}
    </>
  );
}
