'use client';

import { adminQuestionCreate } from '@amora/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { RequirePermission } from '@/components/shell/RouteGuard';
import { useNotify } from '@/components/shell/notice';
import { Button } from '@/components/ui/Button';
import { NumberField, SelectField, TextField } from '@/components/ui/fields';
import { EmptyState, ErrorState, FormError, LoadingState, PageHeader } from '@/components/ui/states';
import { t } from '@/i18n';
import { errorMessage, requestIdOf } from '@/lib/api/errors';
import { useAdminApi, useSession } from '@/lib/auth/session';
import { useFormSubmit } from '@/lib/forms/useFormSubmit';
import { scopedErrors, type FieldErrors } from '@/lib/forms/validate';
import { emptyVersionForm, formToPayload, type VersionForm } from './draft';
import { DraftEditor } from './DraftEditor';
import { labelOf, useQuestionnaireRefs } from './shared';

/** Creates a question with its first (draft) version; publishing happens from the version page. */
export function NewQuestionPage() {
  const { admin } = useSession();
  return (
    <RequirePermission permission="questions.edit" permissions={admin?.permissions ?? []}>
      <NewQuestionForm />
    </RequirePermission>
  );
}

function NewQuestionForm() {
  const api = useAdminApi();
  const router = useRouter();
  const notify = useNotify();
  const refs = useQuestionnaireRefs();
  const { busy, error, fieldErrors, submit } = useFormSubmit();
  const [key, setKey] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [position, setPosition] = useState<number | undefined>(undefined);
  const [form, setForm] = useState<VersionForm>(emptyVersionForm);

  async function create() {
    const { payload, errors } = formToPayload(form);
    const extra: FieldErrors = Object.fromEntries(Object.entries(errors).map(([k, v]) => [`version.${k}`, v]));
    const body = { key: key.trim(), categoryId, ...(position === undefined ? {} : { position }), version: payload };
    await submit(adminQuestionCreate, body, async (b) => {
      const r = await api.questionnaire.create(b);
      notify(t('questionnaire.create.created', { key: b.key }));
      router.push(`/questionnaire/${encodeURIComponent(r.questionId)}/versions/${encodeURIComponent(r.versionId)}`);
    }, extra);
  }

  if (refs.status === 'loading') return <LoadingState />;
  if (refs.status === 'error') return <ErrorState error={refs.error} onRetry={refs.reload} />;
  const errorCount = Object.keys(fieldErrors).length;

  return (
    <>
      <p><Link href="/questionnaire">{t('questionnaire.detail.backToList')}</Link></p>
      <PageHeader title={t('questionnaire.create.title')} intro={t('questionnaire.create.intro')} />
      {refs.data.categories.length === 0 ? (
        <EmptyState message={t('questionnaire.create.noCategories')} action={<Link href="/questionnaire/categories">{t('questionnaire.tabs.categories')}</Link>} />
      ) : (
        <form noValidate onSubmit={(e) => { e.preventDefault(); void create(); }} className="stack">
          {error ? <FormError message={errorMessage(error)} requestId={requestIdOf(error)} /> : null}
          {!error && errorCount > 0 ? <FormError message={t('validation.formHasErrors', { count: errorCount })} /> : null}
          <section className="card stack" aria-labelledby="nq-identity">
            <h2 id="nq-identity" className="card__title">{t('questionnaire.create.identity')}</h2>
            <div className="grid grid--3">
              <TextField label={t('common.key')} hint={t('questionnaire.create.keyHint')} value={key} onChange={setKey} error={fieldErrors.key} required spellCheck={false} data-autofocus />
              <SelectField label={t('questionnaire.list.category')} value={categoryId} onChange={setCategoryId} options={refs.data.categories.map((c) => ({ value: c.id, label: labelOf(c) }))} placeholder={t('questionnaire.create.chooseCategory')} error={fieldErrors.categoryId} required />
              <NumberField label={t('common.position')} hint={t('questionnaire.create.positionHint')} value={position} onChange={setPosition} error={fieldErrors.position} min={0} step={1} />
            </div>
          </section>
          <DraftEditor form={form} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} errors={scopedErrors(fieldErrors, 'version')} refs={refs.data} questionId={null} published={null} />
          <div className="row row--end">
            <Button type="submit" disabled={busy}>{busy ? t('common.saving') : t('questionnaire.create.submit')}</Button>
          </div>
        </form>
      )}
    </>
  );
}
