'use client';

import { adminPublishRequest } from '@amora/shared';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { CheckboxField, TextField } from '@/components/ui/fields';
import { ErrorState, FormError, LoadingState } from '@/components/ui/states';
import { t } from '@/i18n';
import { ApiError } from '@/lib/api/client';
import { errorMessage, requestIdOf } from '@/lib/api/errors';
import type { ImpactReport, PublishResult, QuestionVersion, ValidationIssue } from '@/lib/api/modules/questionnaire';
import { useAdminApi } from '@/lib/auth/session';
import { localInputToIso, validate } from '@/lib/forms/validate';
import { formatDateTime } from '@/lib/format';
import { useResource } from '@/lib/hooks/useResource';
import { ImpactSummary } from './ImpactSummary';
import { IssuesList, issuesFromDetails } from './shared';

interface Props {
  questionKey: string;
  version: QuestionVersion;
  onClose: () => void;
  onDone: (result: PublishResult) => void;
}

/**
 * Publish now or schedule. Loads the impact analysis first so the admin sees who is affected; when answers would
 * be dropped the API requires `acknowledgeImpact`, which is an explicit checkbox here.
 */
export function PublishDialog({ questionKey, version, onClose, onDone }: Props) {
  const api = useAdminApi();
  const impact = useResource(() => api.questionnaire.impact(version.id), [api, version.id]);
  const [mode, setMode] = useState<'now' | 'schedule'>('now');
  const [when, setWhen] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [ackError, setAckError] = useState<string | undefined>();
  const [serverIssues, setServerIssues] = useState<ValidationIssue[] | null>(null);
  const [serverImpact, setServerImpact] = useState<ImpactReport | null>(null);

  const report = serverImpact ?? impact.data ?? null;
  const blocking = (serverIssues ?? report?.issues ?? []).filter((i) => i.code !== 'unmapped_options');
  const needsAck = (report?.usersReasked ?? 0) > 0;

  async function submit() {
    setFieldError(undefined);
    setAckError(undefined);
    let effectiveAt: string | undefined;
    if (mode === 'schedule') {
      const iso = localInputToIso(when);
      if (!iso) return setFieldError(t('validation.invalidDate'));
      if (new Date(iso).getTime() <= Date.now()) return setFieldError(t('questionnaire.publish.mustBeFuture'));
      effectiveAt = iso;
    }
    if (needsAck && !ack) return setAckError(t('questionnaire.publish.ackRequired'));
    const body = validate(adminPublishRequest, { effectiveAt, acknowledgeImpact: ack });
    if (!body.ok) return setFieldError(body.errors.effectiveAt ?? t('validation.invalid'));
    setBusy(true);
    setError(null);
    try {
      const result = await api.questionnaire.publish(version.id, body.data);
      onDone(result);
      onClose();
    } catch (e) {
      setBusy(false);
      setError(e);
      if (e instanceof ApiError && e.code === 'PUBLISH_VALIDATION_FAILED') {
        const details = e.details as { requiresAcknowledgement?: boolean; impact?: ImpactReport } | undefined;
        const issues = issuesFromDetails(details);
        if (issues) setServerIssues(issues);
        if (details?.impact) setServerImpact(details.impact);
        if (details?.requiresAcknowledgement) setAckError(t('questionnaire.publish.ackRequired'));
      }
    }
  }

  const acknowledgement = error instanceof ApiError && error.code === 'PUBLISH_VALIDATION_FAILED' && (error.details as { requiresAcknowledgement?: boolean } | undefined)?.requiresAcknowledgement;

  return (
    <Dialog
      title={t('questionnaire.publish.title', { key: questionKey, version: version.version })}
      onClose={onClose}
      onSubmit={() => void submit()}
      busy={busy}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy} data-autofocus>{t('common.cancel')}</Button>
          <Button type="submit" disabled={busy || impact.status !== 'success' || blocking.length > 0}>
            {busy ? t('common.saving') : mode === 'now' ? t('questionnaire.publish.publishNow') : t('questionnaire.publish.schedule')}
          </Button>
        </>
      }
    >
      <p>{t('questionnaire.publish.body')}</p>
      {error ? (
        acknowledgement ? <FormError message={t('questionnaire.publish.ackServer')} requestId={requestIdOf(error)} /> : <FormError message={errorMessage(error)} requestId={requestIdOf(error)} />
      ) : null}
      {impact.status === 'loading' ? <LoadingState label={t('questionnaire.impact.loading')} /> : null}
      {impact.status === 'error' ? <ErrorState error={impact.error} onRetry={impact.reload} title={t('questionnaire.impact.loadFailed')} /> : null}
      {report ? (
        <section aria-label={t('questionnaire.impact.title')} className="stack">
          <h3>{t('questionnaire.impact.title')}</h3>
          <ImpactSummary impact={report} showIssues={false} />
        </section>
      ) : null}
      {serverIssues ?? report?.issues ? <IssuesList issues={serverIssues ?? report?.issues ?? []} title={t('questionnaire.workflow.issuesTitle')} /> : null}
      {blocking.length > 0 ? <p className="field__error">{t('questionnaire.publish.blocked')}</p> : null}

      <div role="radiogroup" aria-label={t('questionnaire.publish.when')} className="segmented">
        <button type="button" role="radio" aria-checked={mode === 'now'} onClick={() => setMode('now')}>{t('questionnaire.publish.now')}</button>
        <button type="button" role="radio" aria-checked={mode === 'schedule'} onClick={() => setMode('schedule')}>{t('questionnaire.publish.later')}</button>
      </div>
      {mode === 'schedule' ? (
        <TextField type="datetime-local" label={t('questionnaire.publish.effectiveAt')} hint={t('questionnaire.publish.effectiveAtHint')} value={when} onChange={setWhen} error={fieldError} required />
      ) : fieldError ? <p className="field__error" role="alert">{fieldError}</p> : null}
      {mode === 'schedule' && when && localInputToIso(when) ? <p className="muted">{t('questionnaire.publish.scheduledFor', { at: formatDateTime(localInputToIso(when)) })}</p> : null}
      {needsAck || acknowledgement ? (
        <CheckboxField
          label={t('questionnaire.publish.acknowledge', { count: report?.usersReasked ?? 0 })}
          hint={t('questionnaire.publish.acknowledgeHint')}
          checked={ack}
          onChange={setAck}
          error={ackError}
        />
      ) : null}
    </Dialog>
  );
}
