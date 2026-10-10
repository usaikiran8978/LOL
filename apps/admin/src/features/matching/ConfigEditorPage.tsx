'use client';

import { adminMatchingConfigInput, type AdminMatchingConfigInput } from '@amora/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useNotify } from '@/components/shell/notice';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { ErrorState, FormError, LoadingState, PageHeader, StatusBadge } from '@/components/ui/states';
import { t } from '@/i18n';
import { errorMessage, requestIdOf } from '@/lib/api/errors';
import type { CompatibilityCategoryRow, MatchingConfigDetail, MatchingValidationIssue } from '@/lib/api/modules/matching';
import { useAdminApi, useSession } from '@/lib/auth/session';
import { formatDateTime } from '@/lib/format';
import { useFormSubmit } from '@/lib/forms/useFormSubmit';
import { useResource } from '@/lib/hooks/useResource';
import type { Conversion } from '@/lib/predicate';
import { AdvancedJson } from './AdvancedJson';
import { DiversitySection, ExplanationsSection, PoolSection, SafetySection, ScoringSection, type FormUpdate } from './ConfigFields';
import { detailToForm, detailToInput, formToPayload, inputToForm, type ConfigForm } from './configForm';
import { IntentMatrixEditor } from './IntentMatrixEditor';
import { PublishDialog } from './PublishDialog';
import { RankingRulesEditor } from './RankingRulesEditor';
import { MatchingTabs, ValidationIssues, versionLabel } from './shared';
import { WeightsEditor } from './WeightsEditor';

/** Versioned matching config editor: drafts are editable (matching.edit); other versions are read-only. */
export function ConfigEditorPage({ id }: { id: string }) {
  const api = useAdminApi();
  const { can } = useSession();
  const canReadTaxonomy = can('taxonomy.manage');
  const loaded = useResource(async () => {
    const [detail, categories, intents] = await Promise.all([
      api.matching.config(id),
      // Categories only label the weights table; the editor still works from the config's own keys without them.
      api.matching.categories().catch(() => undefined),
      // dating_intent terms come from the taxonomy (taxonomy.manage). Without it the axis is derived from the config.
      canReadTaxonomy ? api.taxonomy.terms('dating_intent').then((terms) => terms.filter((x) => x.is_active).map((x) => x.key)).catch(() => null) : Promise.resolve(null),
    ]);
    return { detail, categories, intents };
  }, [api, id, canReadTaxonomy]);

  if (loaded.status === 'loading') return <><MatchingTabs /><LoadingState /></>;
  if (loaded.status === 'error') return <><MatchingTabs /><ErrorState error={loaded.error} onRetry={loaded.reload} /></>;
  return <Editor key={loaded.data.detail.id} {...loaded.data} />;
}

interface EditorProps {
  detail: MatchingConfigDetail;
  categories: CompatibilityCategoryRow[] | undefined;
  intents: string[] | null;
}

function Editor({ detail: initialDetail, categories, intents }: EditorProps) {
  const api = useAdminApi();
  const { can } = useSession();
  const notify = useNotify();
  const router = useRouter();
  const [detail, setDetail] = useState(initialDetail);
  const [form, setForm] = useState<ConfigForm>(() => detailToForm(initialDetail, intents ?? []));
  const [dirty, setDirty] = useState(false);
  const [mode, setMode] = useState<'form' | 'json'>('form');
  const [issues, setIssues] = useState<MatchingValidationIssue[] | null>(null);
  const [validating, setValidating] = useState(false);
  const [validateError, setValidateError] = useState<unknown>(null);
  const [dialog, setDialog] = useState<'publish' | 'delete' | 'clone' | null>(null);
  const { busy, error, fieldErrors, setFieldErrors, submit } = useFormSubmit();
  const matrixKeysRef = useRef<string[]>([]);

  const isDraft = detail.status === 'draft';
  const editable = isDraft && can('matching.edit');

  // Warn before leaving with unsaved edits (browser navigation; in-app links are plain anchors).
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const update: FormUpdate = (fn) => {
    setForm(fn);
    setDirty(true);
  };

  function onCondition(ruleId: string, conversion: Conversion) {
    setForm((f) => ({
      ...f,
      rankingRules: f.rankingRules.map((r) => {
        if (r.id !== ruleId) return r;
        // The builder reports once on mount; only a changed result is a user edit.
        if (r.condition !== null && JSON.stringify(r.condition) !== JSON.stringify(conversion)) setDirty(true);
        return { ...r, condition: conversion };
      }),
    }));
  }

  function reset(next: MatchingConfigDetail) {
    setDetail(next);
    setForm(detailToForm(next, intents ?? []));
    setDirty(false);
    setFieldErrors({});
    setMode('form');
  }

  async function save() {
    const { payload, errors, matrixKeys } = formToPayload(form);
    matrixKeysRef.current = matrixKeys;
    let saved: MatchingConfigDetail | undefined;
    const ok = await submit(adminMatchingConfigInput, payload, async (d) => { saved = await api.matching.updateDraft(detail.id, d); }, errors);
    if (ok && saved) {
      notify(t('matching.editor.saved', { version: detail.version }));
      reset(saved);
      setIssues(null);
    }
  }

  async function runValidate() {
    setValidating(true);
    setValidateError(null);
    try {
      setIssues((await api.matching.validate(detail.id)).issues);
    } catch (e) {
      setValidateError(e);
    } finally {
      setValidating(false);
    }
  }

  function applyJson(input: AdminMatchingConfigInput) {
    setForm(inputToForm(input, intents ?? []));
    setDirty(true);
    setMode('form');
  }

  // Map `intentMatrix.<i>.<field>` errors (indexes of the last submitted payload) back onto grid cells.
  const cellErrors: Record<string, string> = {};
  for (const [path, msg] of Object.entries(fieldErrors)) {
    const m = /^intentMatrix\.(\d+)\./.exec(path);
    const key = m ? matrixKeysRef.current[Number(m[1])] : undefined;
    if (key) cellErrors[key] ??= msg;
  }
  const errorCount = Object.keys(fieldErrors).length;
  const sectionProps = { form, update, errors: fieldErrors };

  return (
    <>
      <PageHeader
        title={t('matching.editor.title', { version: detail.version })}
        intro={t(editable ? 'matching.editor.introDraft' : 'matching.editor.introReadOnly')}
        actions={
          <>
            <StatusBadge status={detail.status} />
            <Link href="/matching" className="btn btn--ghost">{t('matching.editor.backToVersions')}</Link>
          </>
        }
      />
      <MatchingTabs />
      <div className="toolbar" role="toolbar" aria-label={t('matching.editor.toolbar')}>
        {editable ? <Button onClick={() => void save()} disabled={busy || !dirty}>{busy ? t('common.saving') : t('common.save')}</Button> : null}
        {editable && dirty ? <Button variant="secondary" onClick={() => reset(detail)} disabled={busy}>{t('matching.editor.discard')}</Button> : null}
        {isDraft ? <Button variant="secondary" onClick={() => void runValidate()} disabled={validating || dirty}>{validating ? t('matching.validate.running') : t('matching.validate.action')}</Button> : null}
        {isDraft && can('matching.publish') ? <Button variant="secondary" onClick={() => setDialog('publish')} disabled={dirty}>{t('matching.publish.action')}</Button> : null}
        {!isDraft && can('matching.edit') ? <Button variant="secondary" onClick={() => setDialog('clone')}>{t('matching.editor.cloneAction')}</Button> : null}
        {editable ? <Button variant="danger" onClick={() => setDialog('delete')} disabled={busy}>{t('matching.versions.deleteDraft')}</Button> : null}
        <div className="toolbar__end">
          <div role="group" aria-label={t('matching.editor.viewLabel')} className="segmented">
            <button type="button" aria-pressed={mode === 'form'} onClick={() => setMode('form')}>{t('matching.editor.formView')}</button>
            <button type="button" aria-pressed={mode === 'json'} onClick={() => setMode('json')}>{t('matching.editor.jsonView')}</button>
          </div>
        </div>
      </div>
      {isDraft && dirty ? <p className="muted">{t('matching.editor.unsavedHint')}</p> : null}
      <p className="muted">
        {t('matching.editor.meta', { created: formatDateTime(detail.created_at), published: formatDateTime(detail.published_at) })}
      </p>
      {validateError ? <FormError message={errorMessage(validateError)} requestId={requestIdOf(validateError)} /> : null}
      {issues ? <ValidationIssues issues={issues} /> : null}
      {error ? <FormError message={errorMessage(error)} requestId={requestIdOf(error)} /> : null}
      {!error && errorCount > 0 ? <FormError message={t('validation.formHasErrors', { count: errorCount })} /> : null}

      {mode === 'json' ? (
        <AdvancedJson key={editable ? 'edit' : 'view'} initial={editable ? formToPayload(form).payload : detailToInput(detail)} editable={editable} onApply={applyJson} />
      ) : (
        <form noValidate onSubmit={(e) => { e.preventDefault(); if (editable) void save(); }}>
          <fieldset disabled={!editable} className="stack">
            <legend className="visually-hidden">{t('matching.editor.title', { version: detail.version })}</legend>
            <PoolSection {...sectionProps} />
            <WeightsEditor {...sectionProps} categories={categories} />
            <ScoringSection {...sectionProps} />
            <IntentMatrixEditor form={form} update={update} cellErrors={cellErrors} matrixError={fieldErrors.intentMatrix} taxonomyIntents={intents} defaultScore={form.scalars.intentDefaultScore} />
            <RankingRulesEditor {...sectionProps} onCondition={onCondition} />
            <DiversitySection {...sectionProps} />
            <SafetySection {...sectionProps} />
            <ExplanationsSection {...sectionProps} />
          </fieldset>
        </form>
      )}

      {dialog === 'publish' ? (
        <PublishDialog
          draft={detail}
          onClose={() => setDialog(null)}
          onPublished={(published) => { reset(published); setIssues(null); }}
        />
      ) : null}
      {dialog === 'delete' ? (
        <ConfirmDialog
          title={t('matching.versions.deleteTitle', { version: detail.version })}
          body={t('matching.versions.deleteBody')}
          confirmLabel={t('matching.versions.deleteDraft')}
          tone="danger"
          confirmPhrase={versionLabel(detail.version)}
          onConfirm={async () => {
            await api.matching.deleteDraft(detail.id);
            notify(t('matching.versions.deleted', { version: detail.version }));
            setDirty(false);
            router.push('/matching');
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === 'clone' ? (
        <ConfirmDialog
          title={t('matching.editor.cloneTitle', { version: detail.version })}
          body={t('matching.editor.cloneBody')}
          confirmLabel={t('matching.editor.cloneAction')}
          onConfirm={async () => {
            const created = await api.matching.createDraft(detailToInput(detail));
            notify(t('matching.create.created', { version: created.version }));
            router.push(`/matching/configs/${created.id}`);
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </>
  );
}
