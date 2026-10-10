'use client';

import { adminQuestionOrder } from '@amora/shared';
import { useEffect, useState } from 'react';
import { useNotify } from '@/components/shell/notice';
import { Button } from '@/components/ui/Button';
import { FormDialog } from '@/components/ui/FormDialog';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { t } from '@/i18n';
import type { QuestionCategory, QuestionListRow } from '@/lib/api/modules/questionnaire';
import { useAdminApi } from '@/lib/auth/session';
import { useFormSubmit } from '@/lib/forms/useFormSubmit';
import { useResource } from '@/lib/hooks/useResource';
import { labelOf } from './shared';

/** Display order of all non-archived questions in one category (positions are rewritten 0..n-1). */
export function ReorderDialog({ category, onClose, onSaved }: { category: QuestionCategory; onClose: () => void; onSaved: () => void }) {
  const api = useAdminApi();
  const notify = useNotify();
  const data = useResource(() => api.questionnaire.list({ categoryId: category.id }), [api, category.id]);
  const { busy, error, fieldErrors, submit } = useFormSubmit();
  const [order, setOrder] = useState<QuestionListRow[] | null>(null);

  useEffect(() => {
    if (data.status === 'success') setOrder([...data.data].sort((a, b) => a.position - b.position));
  }, [data.status, data.data]);

  const move = (i: number, delta: number) => setOrder((o) => {
    if (!o) return o;
    const next = [...o];
    const [item] = next.splice(i, 1);
    next.splice(i + delta, 0, item!);
    return next;
  });

  async function save() {
    if (!order) return;
    const ok = await submit(adminQuestionOrder, { categoryId: category.id, questionIds: order.map((q) => q.id) }, (body) => api.questionnaire.reorder(body));
    if (ok) {
      notify(t('questionnaire.reorder.saved'));
      onSaved();
      onClose();
    }
  }

  return (
    <FormDialog title={t('questionnaire.reorder.title', { category: labelOf(category) })} onClose={onClose} onSubmit={() => void save()} busy={busy} error={error} fieldErrors={fieldErrors} submitLabel={t('questionnaire.reorder.save')}>
      {data.status === 'loading' ? <LoadingState /> : null}
      {data.status === 'error' ? <ErrorState error={data.error} onRetry={data.reload} /> : null}
      {order && order.length === 0 ? <EmptyState message={t('questionnaire.reorder.empty')} /> : null}
      {order && order.length > 0 ? (
        <ol className="steps">
          {order.map((q, i) => (
            <li key={q.id} className="row row--between">
              <span><code>{q.key}</code>{q.text ? <> — <span dir="auto">{q.text}</span></> : null}</span>
              <span className="row">
                <Button variant="ghost" size="sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`${t('common.moveUp')} — ${q.key}`}>{t('common.moveUp')}</Button>
                <Button variant="ghost" size="sm" disabled={i === order.length - 1} onClick={() => move(i, 1)} aria-label={`${t('common.moveDown')} — ${q.key}`}>{t('common.moveDown')}</Button>
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </FormDialog>
  );
}
