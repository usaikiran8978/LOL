'use client';

import { uuid } from '@amora/shared';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { DefinitionList } from '@/components/ui/DefinitionList';
import { TextField } from '@/components/ui/fields';
import { EmptyState, FormError } from '@/components/ui/states';
import { t } from '@/i18n';
import { errorMessage, requestIdOf } from '@/lib/api/errors';
import type { UserLocation } from '@/lib/api/modules/users';
import { useAdminApi } from '@/lib/auth/session';
import { formatDateTime, formatNumber } from '@/lib/format';
import { validate } from '@/lib/forms/validate';
import { Card } from './UserSections';

/**
 * Precise location (`users.view_location`). Never fetched automatically: the admin names the incident case and
 * explicitly reveals it; the API logs the access against that case.
 */
export function UserLocationCard({ userId }: { userId: string }) {
  const api = useAdminApi();
  const [caseId, setCaseId] = useState('');
  const [caseError, setCaseError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [revealed, setRevealed] = useState<{ location: UserLocation | null } | null>(null);

  async function reveal() {
    const v = validate(uuid, caseId.trim());
    if (!v.ok) return setCaseError(v.errors[''] ?? t('validation.invalidUuid'));
    setCaseError(undefined);
    setBusy(true);
    setError(null);
    try {
      setRevealed({ location: await api.users.location(userId, v.data) });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={t('users.location.title')} id="user-location">
      <p className="muted">{t('users.location.intro')}</p>
      {revealed ? (
        <div className="stack">
          {revealed.location ? (
            <DefinitionList
              items={[
                { label: t('users.location.latitude'), value: <span className="num">{formatNumber(revealed.location.latitude, 6)}</span> },
                { label: t('users.location.longitude'), value: <span className="num">{formatNumber(revealed.location.longitude, 6)}</span> },
                { label: t('users.location.accuracy'), value: revealed.location.accuracy_m === null ? '—' : t('users.location.accuracyValue', { meters: formatNumber(revealed.location.accuracy_m, 0) }) },
                { label: t('users.location.geohash'), value: <code>{revealed.location.geohash7}</code> },
                { label: t('users.location.source'), value: revealed.location.source },
                { label: t('users.location.capturedAt'), value: formatDateTime(revealed.location.captured_at) },
              ]}
            />
          ) : <EmptyState message={t('users.location.none')} />}
          <div className="row">
            <Button variant="secondary" onClick={() => setRevealed(null)}>{t('users.location.hide')}</Button>
          </div>
        </div>
      ) : (
        <form className="row row--end" noValidate onSubmit={(e) => { e.preventDefault(); void reveal(); }}>
          <TextField
            label={t('users.location.caseId')}
            hint={t('users.location.caseIdHint')}
            value={caseId}
            onChange={setCaseId}
            error={caseError}
            required
            spellCheck={false}
            autoComplete="off"
            className="field--inline"
          />
          <Button type="submit" variant="secondary" disabled={busy}>{busy ? t('users.location.revealing') : t('users.location.reveal')}</Button>
        </form>
      )}
      {error ? <FormError message={errorMessage(error)} requestId={requestIdOf(error)} /> : null}
    </Card>
  );
}
