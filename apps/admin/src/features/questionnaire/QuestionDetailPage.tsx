'use client';

import { adminQuestionMeta } from '@amora/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useNotify } from '@/components/shell/notice';
import { Button } from '@/components/ui/Button';
import { DefinitionList } from '@/components/ui/DefinitionList';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { FormDialog } from '@/components/ui/FormDialog';
import { NumberField, SelectField } from '@/components/ui/fields';
import { ErrorState, FormError, LoadingState, PageHeader } from '@/components/ui/states';
import { t } from '@/i18n';
import { ApiError } from '@/lib/api/client';
import { errorMessage, requestIdOf } from '@/lib/api/errors';
import type { QuestionDetail, QuestionVersion } from '@/lib/api/modules/questionnaire';
import { useAdminApi, useSession } from '@/lib/auth/session';
import { formatDateTime, formatNumber } from '@/lib/format';
import { useFormSubmit } from '@/lib/forms/useFormSubmit';
import { useResource } from '@/lib/hooks/useResource';
import { PublishHistory } from './PublishHistory';
import { QuestionAnalyticsView } from './QuestionAnalytics';
import { RollbackDialog } from './RollbackDialog';
import { answerTypeLabel, categoryName, labelOf, QuestionStateBadge, useQuestionnaireRefs, VersionStatusBadge, type QuestionnaireRefs } from './shared';

type Action = 'activate' | 'deactivate' | 'archive' | 'meta' | { rollback: QuestionVersion } | null;

export function QuestionDetailPage({ questionId }: { questionId: string }) {
  const api = useAdminApi();
  const router = useRouter();
  const { can } = useSession();
  const notify = useNotify();
  const question = useResource(() => api.questionnaire.get(questionId), [api, questionId]);
  const refs = useQuestionnaireRefs();
  const [action, setAction] = useState<Action>(null);
  const [draftBusy, setDraftBusy] = useState(false);
  const [draftError, setDraftError] = useState<unknown>(null);
  const [dependents, setDependents] = useState<string[] | null>(null);

  if (question.status === 'loading' || refs.status === 'loading') return <LoadingState />;
  if (question.status === 'error') return <ErrorState error={question.error} onRetry={question.reload} />;
  if (refs.status === 'error') return <ErrorState error={refs.error} onRetry={refs.reload} />;
  const q = question.data;
  const base = `/questionnaire/${encodeURIComponent(q.id)}`;
  const versionHref = (id: string) => `${base}/versions/${encodeURIComponent(id)}`;
  const pending = q.versions.find((v) => v.status === 'draft' || v.status === 'scheduled');
  const published = q.versions.find((v) => v.id === q.published_version_id);
  const archived = !!q.archived_at;

  async function newDraft() {
    setDraftBusy(true);
    setDraftError(null);
    try {
      const r = await api.questionnaire.createDraft(q.id);
      notify(t('questionnaire.detail.draftCreated'));
      router.push(versionHref(r.versionId));
    } catch (e) {
      const existing = e instanceof ApiError && e.code === 'CONFLICT' ? (e.details as { draftVersionId?: string } | undefined)?.draftVersionId : undefined;
      if (existing) router.push(versionHref(existing));
      else setDraftError(e);
    } finally {
      setDraftBusy(false);
    }
  }

  return (
    <>
      <p><Link href="/questionnaire">{t('questionnaire.detail.backToList')}</Link></p>
      <PageHeader
        title={q.key}
        intro={published?.translations.find((tr) => tr.locale === 'en')?.text}
        actions={
          <>
            {can('questions.edit') && !archived ? (
              pending ? (
                <Link className="btn btn--primary btn--md" href={versionHref(pending.id)}>{t('questionnaire.detail.openPending', { version: pending.version })}</Link>
              ) : (
                <Button onClick={() => void newDraft()} disabled={draftBusy}>{draftBusy ? t('common.saving') : t('questionnaire.detail.newDraft')}</Button>
              )
            ) : null}
            {can('questions.edit') && !archived ? <Button variant="secondary" onClick={() => setAction('meta')}>{t('questionnaire.detail.editMeta')}</Button> : null}
            {can('questions.archive') && !archived && q.published_version_id ? (
              q.is_active
                ? <Button variant="secondary" onClick={() => setAction('deactivate')}>{t('questionnaire.detail.deactivate')}</Button>
                : <Button variant="secondary" onClick={() => setAction('activate')}>{t('questionnaire.detail.activate')}</Button>
            ) : null}
            {can('questions.archive') && !archived ? <Button variant="danger" onClick={() => { setDependents(null); setAction('archive'); }}>{t('questionnaire.detail.archive')}</Button> : null}
          </>
        }
      />
      {draftError ? <FormError message={errorMessage(draftError)} requestId={requestIdOf(draftError)} /> : null}

      <section className="card" aria-labelledby="qd-meta">
        <h2 id="qd-meta" className="card__title">{t('questionnaire.detail.meta')}</h2>
        <DefinitionList
          items={[
            { label: t('common.key'), value: <code>{q.key}</code> },
            { label: t('common.status'), value: <QuestionStateBadge row={q} /> },
            { label: t('questionnaire.list.category'), value: categoryName(refs.data.categories, q.category_id) },
            { label: t('common.position'), value: formatNumber(q.position) },
            { label: t('questionnaire.detail.publishedVersion'), value: published ? t('questionnaire.versions.versionN', { version: published.version }) : t('questionnaire.detail.neverPublished') },
            { label: t('questionnaire.editor.answerType'), value: answerTypeLabel(published?.answerType ?? q.versions[0]?.answerType) },
            { label: t('questionnaire.versions.createdAt'), value: formatDateTime(q.created_at) },
            archived ? { label: t('questionnaire.detail.archivedAt'), value: formatDateTime(q.archived_at) } : null,
          ]}
        />
      </section>

      <VersionsTable question={q} canRollback={can('questions.publish') && !archived && !pending} versionHref={versionHref} onRollback={(v) => setAction({ rollback: v })} />
      <PublishHistory history={q.history} />
      <QuestionAnalyticsView questionId={q.id} versions={q.versions} />

      {action === 'meta' ? <MetaDialog question={q} refs={refs.data} onClose={() => setAction(null)} onSaved={question.reload} /> : null}
      {action === 'activate' || action === 'deactivate' ? (
        <ConfirmDialog
          title={action === 'activate' ? t('questionnaire.detail.activateTitle', { key: q.key }) : t('questionnaire.detail.deactivateTitle', { key: q.key })}
          body={action === 'activate' ? t('questionnaire.detail.activateBody') : t('questionnaire.detail.deactivateBody')}
          confirmLabel={action === 'activate' ? t('questionnaire.detail.activate') : t('questionnaire.detail.deactivate')}
          onConfirm={async () => {
            await (action === 'activate' ? api.questionnaire.activate(q.id) : api.questionnaire.deactivate(q.id));
            notify(action === 'activate' ? t('questionnaire.detail.activated') : t('questionnaire.detail.deactivated'));
            question.reload();
          }}
          onClose={() => setAction(null)}
        />
      ) : null}
      {action === 'archive' ? (
        <ConfirmDialog
          tone="danger"
          title={t('questionnaire.detail.archiveTitle', { key: q.key })}
          body={t('questionnaire.detail.archiveBody')}
          confirmLabel={t('questionnaire.detail.archive')}
          confirmPhrase={q.key}
          onConfirm={async () => {
            try {
              await api.questionnaire.archive(q.id);
            } catch (e) {
              const deps = e instanceof ApiError && e.code === 'CONFLICT' ? (e.details as { dependents?: unknown } | undefined)?.dependents : undefined;
              if (Array.isArray(deps)) setDependents(deps.map(String));
              throw e;
            }
            notify(t('questionnaire.detail.archived'));
            question.reload();
          }}
          onClose={() => setAction(null)}
        >
          {dependents ? (
            <div className="alert alert--error">
              <p>{t('questionnaire.detail.dependents')}</p>
              <ul className="issues">{dependents.map((d) => <li key={d}><code>{d}</code></li>)}</ul>
            </div>
          ) : null}
        </ConfirmDialog>
      ) : null}
      {action && typeof action === 'object' ? (
        <RollbackDialog questionId={q.id} questionKey={q.key} target={action.rollback} onClose={() => setAction(null)} onDone={() => question.reload()} />
      ) : null}
    </>
  );
}

function VersionsTable({ question: q, canRollback, versionHref, onRollback }: {
  question: QuestionDetail; canRollback: boolean; versionHref: (id: string) => string; onRollback: (v: QuestionVersion) => void;
}) {
  return (
    <section className="section" aria-labelledby="qd-versions">
      <h2 id="qd-versions">{t('questionnaire.versions.title')}</h2>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">{t('questionnaire.versions.version')}</th>
              <th scope="col">{t('common.status')}</th>
              <th scope="col">{t('questionnaire.editor.answerType')}</th>
              <th scope="col">{t('questionnaire.editor.text')}</th>
              <th scope="col">{t('questionnaire.versions.createdAt')}</th>
              <th scope="col">{t('questionnaire.versions.publishedAt')}</th>
              <th scope="col">{t('questionnaire.versions.effectiveAt')}</th>
              <th scope="col">{t('questionnaire.editor.changeNote')}</th>
              <th scope="col"><span className="visually-hidden">{t('common.actions')}</span></th>
            </tr>
          </thead>
          <tbody>
            {q.versions.map((v) => {
              const name = t('questionnaire.versions.versionN', { version: v.version });
              const rollbackable = canRollback && v.status !== 'draft' && v.status !== 'scheduled' && v.id !== q.published_version_id;
              return (
                <tr key={v.id} className={v.id === q.published_version_id ? 'is-selected' : undefined}>
                  <td>{name}</td>
                  <td><VersionStatusBadge status={v.status} /></td>
                  <td>{answerTypeLabel(v.answerType)}</td>
                  <td dir="auto">{v.translations.find((tr) => tr.locale === 'en')?.text ?? '—'}</td>
                  <td>{formatDateTime(v.createdAt)}</td>
                  <td>{formatDateTime(v.publishedAt)}</td>
                  <td>{formatDateTime(v.effectiveAt)}</td>
                  <td>{v.changeNote ?? '—'}</td>
                  <td className="table__actions">
                    <Link href={versionHref(v.id)} aria-label={`${v.status === 'draft' ? t('common.edit') : t('common.view')} ${name}`}>{v.status === 'draft' ? t('common.edit') : t('common.view')}</Link>
                    {rollbackable ? (
                      <Button variant="ghost" size="sm" onClick={() => onRollback(v)} aria-label={t('questionnaire.rollback.action', { version: v.version })}>{t('questionnaire.rollback.short')}</Button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function MetaDialog({ question, refs, onClose, onSaved }: { question: QuestionDetail; refs: QuestionnaireRefs; onClose: () => void; onSaved: () => void }) {
  const api = useAdminApi();
  const notify = useNotify();
  const { busy, error, fieldErrors, submit } = useFormSubmit();
  const [categoryId, setCategoryId] = useState(question.category_id);
  const [position, setPosition] = useState<number | undefined>(question.position);

  async function save() {
    const ok = await submit(adminQuestionMeta, { categoryId, position }, (body) => api.questionnaire.updateMeta(question.id, body));
    if (ok) {
      notify(t('common.saved'));
      onSaved();
      onClose();
    }
  }

  return (
    <FormDialog title={t('questionnaire.detail.metaTitle', { key: question.key })} onClose={onClose} onSubmit={() => void save()} busy={busy} error={error} fieldErrors={fieldErrors}>
      <SelectField label={t('questionnaire.list.category')} value={categoryId} onChange={setCategoryId} options={refs.categories.map((c) => ({ value: c.id, label: labelOf(c) }))} error={fieldErrors.categoryId} required />
      <NumberField label={t('common.position')} hint={t('questionnaire.detail.positionHint')} value={position} onChange={setPosition} error={fieldErrors.position} min={0} step={1} />
    </FormDialog>
  );
}
