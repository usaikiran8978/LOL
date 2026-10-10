import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { isApiError, onboardingApi } from '../../api';
import { useSession } from '../../auth/SessionProvider';
import { Button, FormError, ListItem, Notice, ProgressBar, Screen } from '../../components';
import { useAction } from '../../hooks/useAction';
import { formatPercent } from '../../i18n/format';
import { missingRequired } from '../../onboarding/navigation';
import { useOnboarding } from '../../onboarding/OnboardingContext';
import { resolveStep } from '../../onboarding/registry';
import { useTheme } from '../../theme/ThemeProvider';

export default function OnboardingCompleteScreen() {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const router = useRouter();
  const { refreshUser } = useSession();
  const { resource, setState } = useOnboarding();
  const finish = useAction(async () => {
    try {
      setState(await onboardingApi.complete());
    } catch (e) {
      // The server is authoritative about what is missing; refresh our view so the list below matches it.
      if (isApiError(e, 'ONBOARDING_STEP_INVALID')) resource.reload();
      throw e;
    }
    await refreshUser();
    router.replace('/home');
  });

  const state = resource.data;
  if (!state) return <Screen status={resource.status === 'error' ? 'error' : 'loading'} error={resource.error} onRetry={resource.reload} />;
  const missing = new Set(missingRequired(state));
  const serverMissing = isApiError(finish.error, 'ONBOARDING_STEP_INVALID') ? (finish.error.detail<string[]>('missing') ?? []) : [];
  serverMissing.forEach((k) => missing.add(k));

  return (
    <Screen
      decorated
      title={t('onboarding.complete.title')}
      subtitle={t('onboarding.complete.subtitle')}
      testID="onboarding-complete"
      footer={<Button testID="onboarding-finish" label={t('onboarding.complete.finish')} onPress={() => void finish.run()} loading={finish.pending} disabled={missing.size > 0} />}
    >
      <ProgressBar value={state.progress} label={t('onboarding.progress', { percent: formatPercent(state.progress) })} />
      <View style={{ height: spacing.lg }} />
      {missing.size > 0 ? <Notice tone="warning" title={t('onboarding.complete.missing')} testID="onboarding-missing" /> : null}
      <FormError error={missing.size > 0 ? null : finish.error} />
      {state.steps.map((s) => (
        <ListItem
          key={s.key}
          testID={`summary-${s.key}`}
          label={t(resolveStep(s.key).titleKey)}
          value={s.completed ? t('onboarding.status.done') : missing.has(s.key) ? t('onboarding.status.missing') : t('onboarding.status.optional')}
          onPress={() => router.replace(`/onboarding/${s.key}`)}
        />
      ))}
    </Screen>
  );
}
