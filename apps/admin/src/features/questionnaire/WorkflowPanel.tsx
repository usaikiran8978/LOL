'use client';

import { useState } from 'react';
import { useNotify } from '@/components/shell/notice';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { FormError, LoadingState } from '@/components/ui/states';
import { t } from '@/i18n';
import { errorMessage, requestIdOf } from '@/lib/api/errors';
import type { ImpactReport, QuestionDetail, QuestionVersion, ValidationIssue } from '@/lib/api/modules/questionnaire';
import { useAdminApi, useSession } from '@/lib/auth/session';
import { formatDateTime } from '@/lib/format';
import { ImpactSummary } from './ImpactSummary';
import { PreviewPanel } from './PreviewPanel';
import { PublishDialog } from './PublishDialog';
import { RollbackDialog } from './RollbackDialog';
import { IssuesList } from './shared';

type Panel =
  | { kind: 'validate'; status: 'loading' | 'done' | 'error'; issues?: ValidationIssue[]; error?: unknown }
  | { kind: 'impact'; status: 'loading' | 'done' | 'error'; impact?: ImpactReport; error?: unknown }
  | { kind: 'preview' };

interface Props {
  question: QuestionDetail;
  version: QuestionVersion;
  /** Unsaved edits: server-side checks run against the saved draft, so they are disabled until saved. */
  dirty: boolean;
  onChanged: () => void;
  /** After deleting the draft; `questionRemoved` when it was the question's only version. */
  onDeleted: (questionRemoved: boolean) => void;
  onRolledBack: (versionId: string) => void;
}

/** Draft → validate → impact → publish / schedule; cancel schedule; rollback; delete draft; preview. */
export function WorkflowPanel({ question, version, dirty, onChanged, onDeleted, onRolledBack }: Props) {
  const api = useAdminApi();
  const { can } = useSession();
  const notify = useNotify();
  const [panel, setPanel] = useState<Panel | null>(null);
  const [dialog, setDialog] = useState<'publish' | 'cancel' | 'delete' | 'rollback' | null>(null);

  const isDraft = version.status === 'draft';
  const isScheduled = version.status === 'scheduled';
  const isCurrent = question.published_version_id === version.id;
  const pending = question.versions.some((v) => v.status === 'draft' || v.status === 'scheduled');
  const canRollback = !isDraft && !isScheduled && !isCurrent && !question.archived_at;
  const serverChecksDisabled = isDraft && dirty;

  async function runValidate() {
    setPanel({ kind: 'validate', status: 'loading' });
    try {
      const r = await api.questionnaire.validate(version.id);
      setPanel({ kind: 'validate', status: 'done', issues: r.issues });
    } catch (error) {
      setPanel({ kind: 'validate', status: 'error', error });
    }
  }

  async function runImpact() {
    setPanel({ kind: 'impact', status: 'loading' });
    try {
      setPanel({ kind: 'impact', status: 'done', impact: await api.questionnaire.impact(version.id) });
    } catch (error) {
      setPanel({ kind: 'impact', status: 'error', error });
    }
  }

  return (
    <section className="card stack" aria-labelledby="wf-title">
      <h2 id="wf-title" className="card__title">{t('questionnaire.workflow.title')}</h2>
      {isScheduled ? <p>{t('questionnaire.workflow.scheduledFor', { at: formatDateTime(version.effectiveAt) })}</p> : null}
      {!isDraft && !isScheduled ? <p className="muted">{t('questionnaire.workflow.readOnly')}</p> : null}
      {serverChecksDisabled ? <p className="field__hint" role="status">{t('questionnaire.workflow.saveFirst')}</p> : null}
      <div className="toolbar">
        {isDraft ? (
          <>
            <Button variant="secondary" onClick={() => void runValidate()} disabled={serverChecksDisabled}>{t('questionnaire.workflow.validate')}</Button>
            <Button variant="secondary" onClick={() => void runImpact()} disabled={serverChecksDisabled}>{t('questionnaire.workflow.impact')}</Button>
          </>
        ) : null}
        <Button variant="secondary" onClick={() => setPanel({ kind: 'preview' })} disabled={serverChecksDisabled} aria-pressed={panel?.kind === 'preview'}>{t('questionnaire.workflow.preview')}</Button>
        {isDraft && can('questions.publish') ? <Button onClick={() => setDialog('publish')} disabled={dirty}>{t('questionnaire.workflow.publish')}</Button> : null}
        {isScheduled && can('questions.publish') ? <Button variant="secondary" onClick={() => setDialog('cancel')}>{t('questionnaire.workflow.cancelSchedule')}</Button> : null}
        {canRollback && can('questions.publish') ? (
          <Button variant="secondary" onClick={() => setDialog('rollback')} disabled={pending} title={pending ? t('questionnaire.rollback.pendingDraft') : undefined}>
            {t('questionnaire.rollback.action', { version: version.version })}
          </Button>
        ) : null}
        {isDraft && can('questions.edit') ? (
          <div className="toolbar__end">
            <Button variant="danger" onClick={() => setDialog('delete')}>{t('questionnaire.workflow.deleteDraft')}</Button>
          </div>
        ) : null}
      </div>

      {panel?.kind === 'validate' ? (
        <section aria-label={t('questionnaire.workflow.validationResult')} className="stack">
          <h3>{t('questionnaire.workflow.validationResult')}</h3>
          {panel.status === 'loading' ? <LoadingState /> : null}
          {panel.status === 'error' ? <FormError message={errorMessage(panel.error)} requestId={requestIdOf(panel.error)} /> : null}
          {panel.status === 'done' ? (panel.issues!.length ? <IssuesList issues={panel.issues!} /> : <p role="status">{t('questionnaire.workflow.valid')}</p>) : null}
        </section>
      ) : null}
      {panel?.kind === 'impact' ? (
        <section aria-label={t('questionnaire.impact.title')} className="stack">
          <h3>{t('questionnaire.impact.title')}</h3>
          {panel.status === 'loading' ? <LoadingState label={t('questionnaire.impact.loading')} /> : null}
          {panel.status === 'error' ? <FormError message={errorMessage(panel.error)} requestId={requestIdOf(panel.error)} /> : null}
          {panel.status === 'done' ? <ImpactSummary impact={panel.impact!} /> : null}
        </section>
      ) : null}
      {panel?.kind === 'preview' ? (
        <section aria-label={t('questionnaire.preview.title')} className="stack">
          <h3>{t('questionnaire.preview.title')}</h3>
          <PreviewPanel versionId={version.id} />
        </section>
      ) : null}

      {dialog === 'publish' ? (
        <PublishDialog
          questionKey={question.key}
          version={version}
          onClose={() => setDialog(null)}
          onDone={(r) => {
            notify(r.status === 'scheduled' ? t('questionnaire.publish.scheduled', { at: formatDateTime(r.effectiveAt) }) : t('questionnaire.publish.published', { version: version.version }));
            onChanged();
          }}
        />
      ) : null}
      {dialog === 'cancel' ? (
        <ConfirmDialog
          title={t('questionnaire.workflow.cancelTitle', { version: version.version })}
          body={t('questionnaire.workflow.cancelBody')}
          confirmLabel={t('questionnaire.workflow.cancelSchedule')}
          onConfirm={async () => {
            await api.questionnaire.cancelSchedule(version.id);
            notify(t('questionnaire.workflow.cancelled'));
            onChanged();
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === 'delete' ? (
        <ConfirmDialog
          tone="danger"
          title={t('questionnaire.workflow.deleteTitle', { version: version.version })}
          body={question.versions.length === 1 ? t('questionnaire.workflow.deleteOnlyBody', { key: question.key }) : t('questionnaire.workflow.deleteBody')}
          confirmLabel={t('questionnaire.workflow.deleteDraft')}
          confirmPhrase={question.key}
          onConfirm={async () => {
            await api.questionnaire.deleteDraft(version.id);
            notify(t('questionnaire.workflow.deleted'));
            onDeleted(question.versions.length === 1);
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === 'rollback' ? (
        <RollbackDialog questionId={question.id} questionKey={question.key} target={version} onClose={() => setDialog(null)} onDone={onRolledBack} />
      ) : null}
    </section>
  );
}
