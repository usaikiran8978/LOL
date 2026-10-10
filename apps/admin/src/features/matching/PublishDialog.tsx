'use client';

import { useState } from 'react';
import { JsonDiff } from '@/components/editors/JsonDiff';
import { useNotify } from '@/components/shell/notice';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { ErrorState, FormError, LoadingState } from '@/components/ui/states';
import { t } from '@/i18n';
import { errorMessage, requestIdOf } from '@/lib/api/errors';
import type { MatchingConfigDetail } from '@/lib/api/modules/matching';
import { useAdminApi } from '@/lib/auth/session';
import { useResource } from '@/lib/hooks/useResource';
import { detailToInput } from './configForm';
import { issuesFromError, ValidationIssues, versionLabel } from './shared';

/**
 * Publish flow: server-side validation first (blocking issues are shown instead of the confirm button), then a diff
 * of the draft against the currently published version, then explicit confirmation.
 */
export function PublishDialog({ draft, onClose, onPublished }: { draft: MatchingConfigDetail; onClose: () => void; onPublished: (published: MatchingConfigDetail) => void }) {
  const api = useAdminApi();
  const notify = useNotify();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const prep = useResource(async () => {
    const [{ issues }, versions] = await Promise.all([api.matching.validate(draft.id), api.matching.configs()]);
    const pub = versions.find((v) => v.status === 'published');
    const published = pub ? await api.matching.config(pub.id) : null;
    return { issues, published };
  }, [api, draft.id]);

  const serverIssues = issuesFromError(error);
  const issues = serverIssues ?? (prep.status === 'success' ? prep.data.issues : []);
  const canConfirm = prep.status === 'success' && issues.length === 0 && !busy;

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const published = await api.matching.publish(draft.id);
      notify(t('matching.publish.published', { version: draft.version }));
      onPublished(published);
      onClose();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={t('matching.publish.title', { version: draft.version })}
      onClose={onClose}
      size="lg"
      busy={busy}
      onSubmit={() => { if (canConfirm) void confirm(); }}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy} data-autofocus>{t('common.cancel')}</Button>
          {issues.length === 0 ? <Button type="submit" disabled={!canConfirm}>{busy ? t('common.saving') : t('matching.publish.confirm')}</Button> : null}
        </>
      }
    >
      {prep.status === 'loading' ? <LoadingState /> : null}
      {prep.status === 'error' ? <ErrorState error={prep.error} onRetry={prep.reload} /> : null}
      {prep.status === 'success' ? (
        issues.length > 0 ? (
          <>
            <p>{t('matching.publish.blocked')}</p>
            <ValidationIssues issues={issues} />
          </>
        ) : (
          <>
            <p>{t('matching.publish.body')}</p>
            <h3>
              {prep.data.published
                ? t('matching.publish.diffTitle', { from: versionLabel(prep.data.published.version), to: versionLabel(draft.version) })
                : t('matching.publish.firstPublish')}
            </h3>
            <JsonDiff before={prep.data.published ? detailToInput(prep.data.published) : null} after={detailToInput(draft)} />
          </>
        )
      ) : null}
      {error && !serverIssues ? <FormError message={errorMessage(error)} requestId={requestIdOf(error)} /> : null}
    </Dialog>
  );
}
