'use client';

import { adminTemplatePreview, adminTemplateTestSend } from '@amora/shared';
import { useState } from 'react';
import type { z } from 'zod';
import { useNotify } from '@/components/shell/notice';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { DefinitionList } from '@/components/ui/DefinitionList';
import { TextField } from '@/components/ui/fields';
import { ErrorState, FormError, LoadingState } from '@/components/ui/states';
import { t } from '@/i18n';
import { errorMessage, requestIdOf } from '@/lib/api/errors';
import type { NotificationChannel, NotificationTemplate, TemplatePreview, TemplateVersionSummary } from '@/lib/api/modules/notifications';
import { useAdminApi, useSession } from '@/lib/auth/session';
import { validate, type FieldErrors } from '@/lib/forms/validate';
import { useResource } from '@/lib/hooks/useResource';
import { channelLabel } from './shared';
import { HtmlFrame } from './VersionView';

type Outcome = { channel: NotificationChannel; ok: true; data: TemplatePreview } | { channel: NotificationChannel; ok: false; error: unknown };

function nonEmpty(values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).filter(([, v]) => v !== ''));
}

function PreviewResult({ outcome, requested }: { outcome: Outcome; requested: string }) {
  const label = channelLabel(outcome.channel);
  if (!outcome.ok) {
    return (
      <section className="card" aria-label={label}>
        <h4 className="card__title">{label}</h4>
        <FormError message={errorMessage(outcome.error)} requestId={requestIdOf(outcome.error)} />
      </section>
    );
  }
  const r = outcome.data;
  return (
    <section className="card" aria-label={label}>
      <h4 className="card__title">{label}</h4>
      {r.locale !== requested ? <p className="muted">{t('notifications.preview.fallback', { requested, used: r.locale })}</p> : null}
      <DefinitionList
        items={[
          { label: t('notifications.preview.localeUsed'), value: r.locale },
          r.title !== null && { label: t('notifications.versions.title'), value: <span className="pre-wrap" dir="auto">{r.title}</span> },
          r.subject !== null && { label: t('notifications.versions.subject'), value: <span className="pre-wrap" dir="auto">{r.subject}</span> },
          { label: t('notifications.versions.body'), value: <span className="pre-wrap" dir="auto">{r.body}</span> },
        ]}
      />
      {r.htmlBody ? <HtmlFrame html={r.htmlBody} title={t('notifications.versions.htmlFrame', { tag: `${r.locale} · ${label}` })} /> : null}
    </section>
  );
}

/**
 * Preview renders the version being viewed (drafts included). Test-send creates a real notification, so it is
 * offered only for the published version — the one users actually receive.
 */
export function PreviewPanel({ template, version }: { template: NotificationTemplate; version: TemplateVersionSummary | null }) {
  return (
    <section className="card stack" aria-labelledby="preview-title">
      <h3 id="preview-title" className="card__title">{t('notifications.preview.title')}</h3>
      {version === null ? (
        <p className="muted">{t('notifications.preview.needsVersion')}</p>
      ) : (
        <PreviewForm key={version.id} template={template} versionId={version.id} version={version.version} isPublished={version.status === 'published'} />
      )}
    </section>
  );
}

function PreviewForm({ template, versionId, version, isPublished }: { template: NotificationTemplate; versionId: string; version: number; isPublished: boolean }) {
  const api = useAdminApi();
  const { can } = useSession();
  const notify = useNotify();
  const detail = useResource(() => api.notifications.version(template.key, version), [api, template.key, version]);
  const [locale, setLocale] = useState('en');
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<{ locale: string; outcomes: Outcome[] } | null>(null);
  const [userId, setUserId] = useState('');
  const [testErrors, setTestErrors] = useState<FieldErrors>({});
  const [confirmTest, setConfirmTest] = useState<z.output<typeof adminTemplateTestSend> | null>(null);

  async function runPreview() {
    const v = validate(adminTemplatePreview, { locale: locale.trim(), channel: template.channels[0], versionId, variables: nonEmpty(values) });
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    setBusy(true);
    // One request per channel so the admin sees every rendering side by side.
    const settled = await Promise.allSettled(template.channels.map((channel) => api.notifications.preview(template.key, { ...v.data, channel })));
    setResults({
      locale: v.data.locale,
      outcomes: settled.map((s, i): Outcome => {
        const channel = template.channels[i]!;
        return s.status === 'fulfilled' ? { channel, ok: true, data: s.value } : { channel, ok: false, error: s.reason };
      }),
    });
    setBusy(false);
  }

  function reviewTest() {
    const v = validate(adminTemplateTestSend, { userId: userId.trim(), variables: nonEmpty(values) });
    if (!v.ok) return setTestErrors(v.errors);
    setTestErrors({});
    setConfirmTest(v.data);
  }

  if (detail.status === 'loading') return <LoadingState />;
  if (detail.status === 'error') return <ErrorState error={detail.error} onRetry={detail.reload} />;
  const variables = detail.data.variables;

  return (
    <>
      <p className="muted">{t('notifications.preview.intro', { version })}</p>
      {!isPublished ? <p className="muted">{t('notifications.preview.draftNote')}</p> : null}
      <div className="grid grid--3">
        <TextField label={t('notifications.preview.locale')} hint={t('notifications.versions.localeHint')} value={locale} onChange={setLocale} error={errors.locale} required spellCheck={false} maxLength={10} />
        {variables.map((name) => (
          <TextField key={name} label={t('notifications.preview.variable', { name })} value={values[name] ?? ''} onChange={(v) => setValues((s) => ({ ...s, [name]: v }))} error={errors[`variables.${name}`]} maxLength={500} />
        ))}
      </div>
      {variables.length === 0 ? <p className="muted">{t('notifications.preview.noVariables')}</p> : null}
      <div className="row">
        <Button onClick={() => void runPreview()} disabled={busy}>{busy ? t('notifications.preview.rendering') : t('notifications.preview.run')}</Button>
      </div>
      {results ? (
        <div className="grid grid--2" aria-live="polite">
          {results.outcomes.map((o) => <PreviewResult key={o.channel} outcome={o} requested={results.locale} />)}
        </div>
      ) : null}

      {can('notifications.send_test') && isPublished ? (
        <fieldset className="card stack">
          <legend className="card__title">{t('notifications.testSend.title')}</legend>
          <p className="muted">{t('notifications.testSend.intro')}</p>
          <div className="row row--end">
            <TextField label={t('notifications.testSend.userId')} hint={t('notifications.testSend.userIdHint')} value={userId} onChange={setUserId} error={testErrors.userId} required spellCheck={false} maxLength={36} />
            <Button variant="secondary" onClick={reviewTest}>{t('notifications.testSend.send')}</Button>
          </div>
        </fieldset>
      ) : null}
      {confirmTest ? (
        <ConfirmDialog
          title={t('notifications.testSend.confirmTitle', { key: template.key })}
          body={t('notifications.testSend.confirmBody', { userId: confirmTest.userId })}
          confirmLabel={t('notifications.testSend.send')}
          onConfirm={async () => {
            const r = await api.notifications.testSend(template.key, confirmTest);
            notify(t('notifications.testSend.sent', { count: r.created }));
          }}
          onClose={() => setConfirmTest(null)}
        />
      ) : null}
    </>
  );
}
