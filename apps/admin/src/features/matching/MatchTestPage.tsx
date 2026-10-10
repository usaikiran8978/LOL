'use client';

import { adminMatchTestRequest } from '@amora/shared';
import { useState } from 'react';
import { RequirePermission } from '@/components/shell/RouteGuard';
import { Button } from '@/components/ui/Button';
import { SelectField, TextField } from '@/components/ui/fields';
import { FormError, PageHeader } from '@/components/ui/states';
import { t } from '@/i18n';
import { errorMessage, requestIdOf } from '@/lib/api/errors';
import type { CompatibilityCategoryRow, MatchTestResult } from '@/lib/api/modules/matching';
import { useAdminApi, useSession } from '@/lib/auth/session';
import { useFormSubmit } from '@/lib/forms/useFormSubmit';
import { useResource } from '@/lib/hooks/useResource';
import { MatchTestResultView } from './MatchTestResultView';
import { MatchingTabs, versionLabel } from './shared';

/** "Test Matching Rules": full score breakdown for two real users under a chosen config version (audited access). */
export function MatchTestPage() {
  const { admin } = useSession();
  return (
    <RequirePermission permission="matching.test" permissions={admin?.permissions ?? []}>
      <MatchTest />
    </RequirePermission>
  );
}

function MatchTest() {
  const api = useAdminApi();
  const { can } = useSession();
  const canView = can('matching.view');
  // Version list and category labels are optional context (matching.view); the test itself only needs matching.test.
  const context = useResource(async () => {
    if (!canView) return { versions: null, categories: null };
    const [versions, categories] = await Promise.all([api.matching.configs().catch(() => null), api.matching.categories().catch(() => null)]);
    return { versions, categories };
  }, [api, canView]);
  const { busy, error, fieldErrors, submit } = useFormSubmit();
  const [userA, setUserA] = useState('');
  const [userB, setUserB] = useState('');
  const [configVersionId, setConfigVersionId] = useState('');
  const [result, setResult] = useState<{ data: MatchTestResult; categories: CompatibilityCategoryRow[] | null } | null>(null);

  const versions = context.data?.versions ?? null;

  async function run() {
    const payload = { userA: userA.trim() || undefined, userB: userB.trim() || undefined, ...(configVersionId ? { configVersionId } : {}) };
    await submit(adminMatchTestRequest, payload, async (d) => {
      setResult(null);
      const data = await api.matching.test(d);
      setResult({ data, categories: context.data?.categories ?? null });
    });
  }

  return (
    <>
      <PageHeader title={t('matching.test.title')} intro={t('matching.test.intro')} />
      <MatchingTabs />
      <form className="card" noValidate onSubmit={(e) => { e.preventDefault(); void run(); }} aria-labelledby="match-test-form">
        <h2 id="match-test-form" className="card__title">{t('matching.test.formTitle')}</h2>
        <p className="alert alert--info">{t('matching.test.auditNote')}</p>
        <div className="grid grid--3">
          <TextField label={t('matching.test.userA')} hint={t('matching.test.userIdHint')} value={userA} onChange={setUserA} error={fieldErrors.userA} required spellCheck={false} autoComplete="off" />
          <TextField label={t('matching.test.userB')} hint={t('matching.test.userIdHint')} value={userB} onChange={setUserB} error={fieldErrors.userB} required spellCheck={false} autoComplete="off" />
          {versions ? (
            <SelectField
              label={t('matching.test.configVersion')}
              value={configVersionId}
              onChange={setConfigVersionId}
              placeholder={t('matching.test.publishedVersion')}
              options={versions.map((v) => ({ value: v.id, label: `${versionLabel(v.version)} — ${t(`status.${v.status}`)}` }))}
              error={fieldErrors.configVersionId}
            />
          ) : (
            <TextField label={t('matching.test.configVersionId')} hint={t('matching.test.configVersionIdHint')} value={configVersionId} onChange={setConfigVersionId} error={fieldErrors.configVersionId} spellCheck={false} />
          )}
        </div>
        <div className="row">
          <Button type="submit" disabled={busy}>{busy ? t('matching.test.running') : t('matching.test.run')}</Button>
        </div>
        {error ? <FormError message={errorMessage(error)} requestId={requestIdOf(error)} /> : null}
      </form>
      {result ? <MatchTestResultView result={result.data} categories={result.categories} /> : null}
    </>
  );
}
