import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Button, FormError, ProgressBar, Screen, Text, useToast } from '../../components';
import { useAction } from '../../hooks/useAction';
import { formatNumber, formatPercent } from '../../i18n/format';
import { previousStep, stepPosition } from '../../onboarding/navigation';
import { useOnboarding } from '../../onboarding/OnboardingContext';
import { resolveStep } from '../../onboarding/registry';
import { useTheme } from '../../theme/ThemeProvider';

export default function OnboardingStepScreen() {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const { step: rawStep } = useLocalSearchParams<{ step: string }>();
  const key = String(rawStep ?? '');
  const { resource, completeStep, skipStep, saveDraft } = useOnboarding();
  const draftGetter = useRef<(() => Record<string, unknown>) | null>(null);
  const registerDraft = useCallback((g: () => Record<string, unknown>) => {
    draftGetter.current = g;
  }, []);

  const go = (next: string | null) => router.replace(next ? `/onboarding/${next}` : '/onboarding/complete');
  const onSaved = async () => go(await completeStep(key));
  const later = useAction(async () => {
    await saveDraft(key, draftGetter.current?.() ?? {});
    toast.show(t('onboarding.savedForLater'), 'success');
    router.replace('/home');
  });

  const state = resource.data;
  if (!state) return <Screen status={resource.status === 'error' ? 'error' : 'loading'} error={resource.error} onRetry={resource.reload} />;
  const stepState = state.steps.find((s) => s.key === key);
  // Not part of the current (applicable) flow, e.g. a stale deep link: resume from the server's view instead.
  if (!stepState) return <Redirect href="/onboarding" />;

  const def = resolveStep(key);
  const { index, total } = stepPosition(state, key);
  const prev = previousStep(state, key);
  const draft = state.draft.step === key ? state.draft : null;

  return (
    <Screen
      decorated
      testID={`onboarding-step-${key}`}
      header={
        <View style={{ marginBottom: spacing.lg }}>
          <Text variant="caption" color="textMuted" style={{ marginBottom: spacing.xs }}>
            {t('onboarding.stepOf', { index: formatNumber(index), total: formatNumber(total) })}
          </Text>
          <ProgressBar value={state.progress} label={t('onboarding.progress', { percent: formatPercent(state.progress) })} testID="onboarding-progress" />
        </View>
      }
      title={t(def.titleKey)}
      subtitle={t(def.bodyKey)}
      footer={
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
          {prev ? <Button variant="ghost" label={t('common.back')} onPress={() => router.replace(`/onboarding/${prev}`)} /> : <View />}
          {!stepState.required ? <Button testID="onboarding-skip" variant="ghost" label={t('onboarding.skip')} onPress={() => go(skipStep(key))} /> : null}
          <Button testID="onboarding-later" variant="ghost" label={t('onboarding.finishLater')} onPress={() => void later.run()} loading={later.pending} />
        </View>
      }
    >
      {stepState.required ? (
        <Text variant="caption" color="textMuted" style={{ marginBottom: spacing.md }}>
          {t('onboarding.required')}
        </Text>
      ) : null}
      <FormError error={later.error} />
      <def.Component stepKey={key} required={stepState.required} submitLabel={t('common.continue')} onSaved={onSaved} registerDraft={registerDraft} draft={draft} />
    </Screen>
  );
}
