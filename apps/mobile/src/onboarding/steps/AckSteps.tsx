import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { usersApi } from '../../api';
import { questionnaireApi } from '../../api/questionnaire';
import { registerForPush } from '../../notifications/push';
import { Button, FormError, Notice, ProgressBar, Text, ToggleRow } from '../../components';
import { LoadState } from '../../features/profile/LoadState';
import { useAction } from '../../hooks/useAction';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';
import { useResource } from '../../hooks/useResource';
import { formatNumber } from '../../i18n/format';
import { useTheme } from '../../theme/ThemeProvider';
import type { StepComponentProps } from '../registry';

/**
 * Questionnaire step: answering happens in the full questionnaire flow; the step completes once the server reports
 * no required questions remaining (the step check in onboarding.service.ts uses the same status).
 */
export function QuestionnaireStep({ onSaved, required }: StepComponentProps) {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const router = useRouter();
  const status = useResource(questionnaireApi.status);
  useRefreshOnFocus(status.reload);
  const done = useAction(async () => onSaved());
  const s = status.data;
  const canContinue = !!s && (s.requiredRemaining === 0 || !required);
  return (
    <LoadState resources={[status]}>
      {() => (
        <View>
          <ProgressBar value={s!.total ? (s!.answered / s!.total) * 100 : 0} label={t('questionnaire.progress', { answered: formatNumber(s!.answered), total: formatNumber(s!.total) })} testID="onboarding-questionnaire-progress" />
          <Text variant="caption" color="textMuted" style={{ marginTop: spacing.xs, marginBottom: spacing.lg }}>
            {t('questionnaire.progress', { answered: formatNumber(s!.answered), total: formatNumber(s!.total) })}
          </Text>
          {s!.requiredRemaining > 0 ? <Notice tone="warning" title={t('questionnaire.requiredRemaining', { count: formatNumber(s!.requiredRemaining) })} testID="questionnaire-required" /> : null}
          <Button testID="open-questionnaire" variant={canContinue ? 'secondary' : 'primary'} label={s!.answered ? t('questionnaire.continueAnswering') : t('questionnaire.start')} onPress={() => router.push('/questionnaire')} />
          <View style={{ height: spacing.md }} />
          <FormError error={done.error} />
          <Button testID="ack-continue" label={t('common.continue')} disabled={!canContinue} onPress={() => void done.run()} loading={done.pending} />
        </View>
      )}
    </LoadState>
  );
}

/** Permission primer: records the location consent and, when chosen, asks the OS for push permission. */
export function PermissionsStep({ onSaved }: StepComponentProps) {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const [location, setLocation] = useState(false);
  const [push, setPush] = useState(false);
  const [pushDenied, setPushDenied] = useState(false);
  const done = useAction(async () => {
    if (location) await usersApi.setConsent({ consentType: 'location', granted: true });
    if (push) {
      // Push is optional: a denied permission or registration failure never blocks onboarding.
      const result = await registerForPush({ prompt: true }).catch(() => 'unsupported' as const);
      if (result === 'denied') setPushDenied(true);
    }
    await onSaved();
  });
  return (
    <View>
      <ToggleRow testID="perm-location" label={t('onboarding.permissions.location')} description={t('onboarding.permissions.locationHint')} value={location} onChange={setLocation} />
      <View style={{ height: spacing.md }} />
      <ToggleRow testID="perm-notifications" label={t('onboarding.permissions.notifications')} description={t('onboarding.permissions.notificationsHint')} value={push} onChange={setPush} />
      {pushDenied ? <Notice tone="warning" title={t('notifications.permissionDenied')} /> : null}
      <FormError error={done.error} />
      <Button testID="ack-continue" label={t('common.continue')} onPress={() => void done.run()} loading={done.pending} />
    </View>
  );
}

/** Photo verification is optional during onboarding: offer the flow, then continue either way. */
export function VerificationStep({ onSaved }: StepComponentProps) {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const router = useRouter();
  const done = useAction(async () => onSaved());
  return (
    <View>
      <Notice testID="verification-intro" title={t('onboarding.verification.title')} body={t('onboarding.verification.body')} />
      <Button testID="open-verification" variant="secondary" label={t('verification.start')} onPress={() => router.push('/safety/verification')} />
      <View style={{ height: spacing.md }} />
      <FormError error={done.error} />
      <Button testID="ack-continue" label={t('common.continue')} onPress={() => void done.run()} loading={done.pending} />
    </View>
  );
}

/** Any admin-defined step this app version does not know: acknowledge so the flow is never blocked. */
export function GenericAckStep({ onSaved }: StepComponentProps) {
  const { t } = useTranslation();
  const done = useAction(async () => onSaved());
  return (
    <View testID="generic-step">
      <Notice title={t('onboarding.steps.generic.body')} />
      <FormError error={done.error} />
      <Button testID="ack-continue" label={t('common.continue')} onPress={() => void done.run()} loading={done.pending} />
    </View>
  );
}
