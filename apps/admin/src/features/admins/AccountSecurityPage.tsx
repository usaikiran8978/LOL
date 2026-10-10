'use client';

import { Badge } from '@/components/ui/Badge';
import { DefinitionList } from '@/components/ui/DefinitionList';
import { ErrorState, LoadingState, PageHeader } from '@/components/ui/states';
import { t } from '@/i18n';
import { useAdminApi, useSession } from '@/lib/auth/session';
import { formatDateTime } from '@/lib/format';
import { useResource } from '@/lib/hooks/useResource';
import { MfaDisableButton, MfaSetupPanel } from './MfaPanels';

/** Own-account security (any signed-in admin; no permission required). */
export function AccountSecurityPage() {
  const api = useAdminApi();
  const session = useSession();
  const me = useResource(() => api.admins.me(), [api]);
  // Once MFA is set up the shell must stop redirecting here, so refresh the session identity too.
  const onSetupDone = () => (session.admin?.mfaSetupRequired ? session.reload() : me.reload());

  return (
    <>
      <PageHeader title={t('admins.account.title')} intro={t('admins.account.intro')} />
      {me.status === 'loading' ? <LoadingState /> : null}
      {me.status === 'error' ? <ErrorState error={me.error} onRetry={me.reload} /> : null}
      {me.status === 'success' ? (
        <>
          <section className="card" aria-labelledby="account-profile">
            <h2 id="account-profile" className="card__title">{t('admins.account.profile')}</h2>
            <DefinitionList
              items={[
                { label: t('admins.account.email'), value: me.data.email },
                { label: t('admins.account.name'), value: me.data.displayName || '—' },
                { label: t('admins.account.sessionExpires'), value: formatDateTime(me.data.sessionExpiresAt) },
              ]}
            />
          </section>
          <section className="card stack" aria-labelledby="account-mfa">
            <h2 id="account-mfa" className="card__title">{t('admins.account.mfaTitle')}</h2>
            {me.data.mfaEnabled ? (
              <>
                <p><Badge tone="success">{t('admins.list.mfaOn')}</Badge> {t('admins.account.mfaEnabled')}</p>
                <MfaDisableButton onChanged={me.reload} />
              </>
            ) : (
              <>
                <p><Badge tone="warning">{t('admins.list.mfaOff')}</Badge> {t('admins.account.mfaDisabled')}</p>
                {me.data.mfaSetupRequired ? <p className="alert alert--info" role="status">{t('admins.account.mfaRequired')}</p> : null}
                <MfaSetupPanel onChanged={onSetupDone} />
              </>
            )}
          </section>
        </>
      ) : null}
    </>
  );
}
