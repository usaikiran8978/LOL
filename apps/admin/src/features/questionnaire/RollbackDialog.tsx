'use client';

import { useState } from 'react';
import { useNotify } from '@/components/shell/notice';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { t } from '@/i18n';
import { ApiError } from '@/lib/api/client';
import type { QuestionVersion, ValidationIssue } from '@/lib/api/modules/questionnaire';
import { useAdminApi } from '@/lib/auth/session';
import { IssuesList, issuesFromDetails } from './shared';

/** Rollback publishes a copy of an earlier version as a new version (history is never rewritten). */
export function RollbackDialog({ questionId, questionKey, target, onClose, onDone }: {
  questionId: string; questionKey: string; target: QuestionVersion; onClose: () => void; onDone: (newVersionId: string) => void;
}) {
  const api = useAdminApi();
  const notify = useNotify();
  const [issues, setIssues] = useState<ValidationIssue[] | null>(null);
  const [pendingDraft, setPendingDraft] = useState(false);

  return (
    <ConfirmDialog
      title={t('questionnaire.rollback.title', { version: target.version })}
      body={t('questionnaire.rollback.body', { key: questionKey, version: target.version })}
      confirmLabel={t('questionnaire.rollback.confirm')}
      onConfirm={async () => {
        setIssues(null);
        setPendingDraft(false);
        try {
          const r = await api.questionnaire.rollback(questionId, target.id);
          notify(t('questionnaire.rollback.done', { version: target.version }));
          onDone(r.versionId);
        } catch (e) {
          if (e instanceof ApiError && e.code === 'PUBLISH_VALIDATION_FAILED') setIssues(issuesFromDetails(e.details));
          if (e instanceof ApiError && e.code === 'CONFLICT' && (e.details as { versionId?: string } | undefined)?.versionId) setPendingDraft(true);
          throw e;
        }
      }}
      onClose={onClose}
    >
      {pendingDraft ? <p className="field__error">{t('questionnaire.rollback.pendingDraft')}</p> : null}
      {issues ? <IssuesList issues={issues} title={t('questionnaire.rollback.invalid')} /> : null}
    </ConfirmDialog>
  );
}
