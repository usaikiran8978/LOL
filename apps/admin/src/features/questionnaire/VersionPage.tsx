'use client';

import { adminVersionInput } from '@amora/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useNotify } from '@/components/shell/notice';
import { Button } from '@/components/ui/Button';
import { ErrorState, FormError, LoadingState, PageHeader } from '@/components/ui/states';
import { t } from '@/i18n';
import { ApiError } from '@/lib/api/client';
import { errorMessage, requestIdOf } from '@/lib/api/errors';
import type { QuestionDetail, QuestionVersion } from '@/lib/api/modules/questionnaire';
import { useAdminApi, useSession } from '@/lib/auth/session';
import { useFormSubmit } from '@/lib/forms/useFormSubmit';
import { useResource } from '@/lib/hooks/useResource';
import { formToPayload, versionToForm, type VersionForm } from './draft';
import { DraftEditor } from './DraftEditor';
import { useQuestionnaireRefs, VersionStatusBadge, type QuestionnaireRefs } from './shared';
import { VersionSummary } from './VersionSummary';
import { WorkflowPanel } from './WorkflowPanel';

/** One version of a question: draft editor + workflow for drafts, read-only view otherwise. */
export function VersionPage({ questionId, versionId }: { questionId: string; versionId: string }) {
  const api = useAdminApi();
  const router = useRouter();
  const question = useResource(() => api.questionnaire.get(questionId), [api, questionId]);
  const refs = useQuestionnaireRefs();

  if (question.status === 'loading' || refs.status === 'loading') return <LoadingState />;
  if (question.status === 'error') return <ErrorState error={question.error} onRetry={question.reload} />;
  if (refs.status === 'error') return <ErrorState error={refs.error} onRetry={refs.reload} />;
  const version = question.data.versions.find((v) => v.id === versionId);
  if (!version) return <ErrorState error={new ApiError(404, 'NOT_FOUND', 'version not found')} onRetry={question.reload} />;

  return (
    <VersionWorkspace
      key={version.id}
      question={question.data}
      version={version}
      refs={refs.data}
      reload={question.reload}
      onNavigate={(href) => router.push(href)}
    />
  );
}

function VersionWorkspace({ question, version, refs, reload, onNavigate }: {
  question: QuestionDetail; version: QuestionVersion; refs: QuestionnaireRefs; reload: () => void; onNavigate: (href: string) => void;
}) {
  const api = useAdminApi();
  const { can } = useSession();
  const notify = useNotify();
  const { busy, error, fieldErrors, submit } = useFormSubmit();
  const editable = version.status === 'draft' && can('questions.edit');
  const [form, setForm] = useState<VersionForm>(() => versionToForm(version));
  const [baseline, setBaseline] = useState(() => JSON.stringify(formToPayload(versionToForm(version)).payload));
  const published = question.versions.find((v) => v.id === question.published_version_id) ?? null;
  const current = useMemo(() => JSON.stringify(formToPayload(form).payload), [form]);
  const dirty = editable && current !== baseline;
  const detailHref = `/questionnaire/${encodeURIComponent(question.id)}`;

  async function save() {
    const { payload, errors } = formToPayload(form);
    const snapshot = JSON.stringify(payload);
    const ok = await submit(adminVersionInput, payload, (body) => api.questionnaire.updateDraft(version.id, body), errors);
    if (ok) {
      setBaseline(snapshot);
      notify(t('questionnaire.editor.saved'));
      reload();
    }
  }

  const staleError = error instanceof ApiError && (error.code === 'VERSION_IMMUTABLE' || error.code === 'VERSION_STALE');
  const errorCount = Object.keys(fieldErrors).length;

  return (
    <>
      <p><Link href={detailHref}>{t('questionnaire.detail.back', { key: question.key })}</Link></p>
      <PageHeader
        title={t('questionnaire.versions.pageTitle', { key: question.key, version: version.version })}
        intro={editable ? t('questionnaire.editor.intro') : undefined}
        actions={
          <>
            <VersionStatusBadge status={version.status} />
            {editable ? <Button onClick={() => void save()} disabled={busy || !dirty}>{busy ? t('common.saving') : t('questionnaire.editor.saveDraft')}</Button> : null}
          </>
        }
      />
      {dirty ? <p className="field__hint" role="status">{t('questionnaire.editor.unsaved')}</p> : null}
      {staleError ? (
        <div className="alert alert--error" role="alert">
          <p>{(error as ApiError).code === 'VERSION_IMMUTABLE' ? t('questionnaire.editor.immutable') : t('questionnaire.editor.stale')}</p>
          <Button variant="secondary" size="sm" onClick={reload}>{t('questionnaire.editor.reloadVersion')}</Button>
        </div>
      ) : error ? <FormError message={errorMessage(error)} requestId={requestIdOf(error)} /> : null}
      {!error && errorCount > 0 ? <FormError message={t('validation.formHasErrors', { count: errorCount })} /> : null}

      <WorkflowPanel
        question={question}
        version={version}
        dirty={dirty}
        onChanged={reload}
        onDeleted={(removed) => onNavigate(removed ? '/questionnaire' : detailHref)}
        onRolledBack={(vid) => onNavigate(`${detailHref}/versions/${encodeURIComponent(vid)}`)}
      />

      {editable ? (
        <form noValidate onSubmit={(e) => { e.preventDefault(); void save(); }} className="stack section">
          <DraftEditor form={form} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} errors={fieldErrors} refs={refs} questionId={question.id} published={published} />
          <div className="row row--end">
            <Button type="submit" disabled={busy || !dirty}>{busy ? t('common.saving') : t('questionnaire.editor.saveDraft')}</Button>
          </div>
        </form>
      ) : (
        <div className="section">
          {version.status === 'draft' ? <p className="muted">{t('questionnaire.editor.noEditPermission')}</p> : null}
          <VersionSummary version={version} refs={refs} />
        </div>
      )}
    </>
  );
}
