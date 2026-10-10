import { consentUpdate } from '@amora/shared';
import { useTranslation } from 'react-i18next';
import { analytics } from '../../analytics';
import { usersApi, type ConsentState, type ConsentType } from '../../api';
import { FormError, Screen, ToggleRow } from '../../components';
import { useFlag } from '../../config/ConfigProvider';
import { useAction } from '../../hooks/useAction';
import { useResource } from '../../hooks/useResource';
import { formatDate } from '../../i18n/format';

export const CONSENT_TYPES = consentUpdate.shape.consentType.options as readonly ConsentType[];

/** Analytics runs unless withdrawn (matches what the session layer applies); everything else is opt-in. */
const grantedByDefault = (type: string) => type === 'analytics';

export default function ConsentsScreen() {
  const { t } = useTranslation();
  const crossedPaths = useFlag('crossed_paths');
  const consents = useResource(usersApi.consents);
  // Consents for features that are switched off for this user are not shown (nothing to consent to).
  const types = CONSENT_TYPES.filter((c) => c !== 'crossed_paths' || crossedPaths);
  const current = (type: string): ConsentState | undefined => consents.data?.find((c) => c.consentType === type);

  const set = useAction(async (type: ConsentType, granted: boolean) => {
    consents.setData(await usersApi.setConsent({ consentType: type, granted }));
    if (type === 'analytics') analytics.setConsent(granted);
  });

  return (
    <Screen title={t('settings.consents')} subtitle={t('consents.subtitle')} status={consents.data ? 'ready' : consents.status} error={consents.error} onRetry={consents.reload} testID="consents-screen">
      <FormError error={set.error} />
      {types.map((type) => {
        const c = current(type);
        const value = c ? c.granted : grantedByDefault(type);
        return (
          <ToggleRow
            key={type}
            testID={`consent-${type}`}
            label={t(`consents.types.${type}`)}
            description={c ? t('consents.updated', { date: formatDate(c.updatedAt) }) : t('consents.notRecorded')}
            value={value}
            disabled={set.pending}
            onChange={(v) => void set.run(type, v)}
          />
        );
      })}
    </Screen>
  );
}
