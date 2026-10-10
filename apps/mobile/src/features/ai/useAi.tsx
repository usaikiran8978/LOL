import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { analytics } from '../../analytics';
import { isApiError, isConsentType, profileApi, usersApi } from '../../api';
import { Button, FormError, Notice } from '../../components';
import { useAction } from '../../hooks/useAction';
import { useTheme } from '../../theme/ThemeProvider';
import { gateFor, usePaywall } from '../premium/paywall';

type ConsentNeed = { consentType: string | null; setting: string | null };
export interface AiLike {
  consent: ConsentNeed | null;
  error: unknown;
  grantPending: boolean;
  grantError: unknown;
  grantAndRetry: () => Promise<unknown>;
  dismissConsent: () => void;
}

/**
 * Runs an AI request and handles the API's AI-specific outcomes: consent prompts (CONSENT_REQUIRED with either a
 * consent type or a privacy setting), unavailable/not-configured states, and limits/entitlements (paywall).
 */
export function useAi<A extends unknown[], R>(feature: string, fn: (...args: A) => Promise<R>) {
  const [consent, setConsent] = useState<ConsentNeed | null>(null);
  const [lastArgs, setLastArgs] = useState<A | null>(null);
  const action = useAction(async (...args: A) => {
    setLastArgs(args);
    try {
      const r = await fn(...args);
      analytics.track('ai_feature_used', { feature });
      return r;
    } catch (e) {
      const g = gateFor(e);
      if (g?.kind === 'consent') {
        setConsent({ consentType: g.consentType, setting: g.setting });
        return undefined;
      }
      throw e;
    }
  });

  const grant = useAction(async () => {
    if (!consent) return;
    if (isConsentType(consent.consentType)) await usersApi.setConsent({ consentType: consent.consentType, granted: true });
    else if (consent.setting) await profileApi.setPrivacy({ [consent.setting]: true });
    setConsent(null);
  });

  const grantAndRetry = useCallback(async () => {
    await grant.run();
    if (lastArgs) return action.run(...lastArgs);
    return undefined;
  }, [grant, lastArgs, action]);

  return { ...action, consent, grantPending: grant.pending, grantError: grant.error, grantAndRetry, dismissConsent: () => setConsent(null) };
}

/** Consent prompt + error presentation shared by every AI surface. */
export function AiStatus({ ai, surface, testID = 'ai-status' }: { ai: AiLike; surface: string; testID?: string }) {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const router = useRouter();
  const openPaywall = usePaywall();
  if (ai.consent) {
    return (
      <View testID={`${testID}-consent`}>
        <Notice title={t('ai.consentTitle')} body={ai.consent.setting === 'allowAiMessageAnalysis' ? t('ai.consentMessagesBody') : t('ai.consentBody')} />
        <FormError error={ai.grantError} />
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg, flexWrap: 'wrap' }}>
          <Button label={t('ai.allow')} onPress={() => void ai.grantAndRetry()} loading={ai.grantPending} testID={`${testID}-allow`} />
          <Button variant="ghost" label={t('ai.terms')} onPress={() => router.push({ pathname: '/legal/[type]', params: { type: 'ai_terms' } })} />
          <Button variant="ghost" label={t('common.cancel')} onPress={ai.dismissConsent} />
        </View>
      </View>
    );
  }
  if (!ai.error) return null;
  const g = gateFor(ai.error);
  // Turned off by the member in Privacy settings: say so and link there (the feature itself is available).
  if (g?.kind === 'setting_off') {
    return (
      <View testID={`${testID}-setting-off`}>
        <Notice title={t(g.setting === 'allowTranslation' ? 'ai.translationOffTitle' : 'ai.settingOffTitle')} body={t('ai.settingOffBody')} />
        <Button variant="secondary" label={t('ai.openPrivacy')} onPress={() => router.push('/settings/privacy')} testID={`${testID}-open-privacy`} style={{ marginBottom: spacing.lg }} />
      </View>
    );
  }
  if (isApiError(ai.error, 'AI_NOT_CONFIGURED') || isApiError(ai.error, 'AI_UNAVAILABLE') || isApiError(ai.error, 'FEATURE_DISABLED')) {
    return <Notice testID={`${testID}-unavailable`} title={t(isApiError(ai.error, 'AI_UNAVAILABLE') ? 'ai.unavailableTitle' : 'ai.notConfiguredTitle')} body={t('ai.unavailableBody')} />;
  }
  if (g?.kind === 'paywall') {
    return (
      <View testID={`${testID}-limit`}>
        <Notice tone="warning" title={t('ai.limitTitle')} />
        <Button label={t('premium.upgrade')} onPress={() => openPaywall(surface, g.entitlement)} style={{ marginBottom: spacing.lg }} />
      </View>
    );
  }
  return <FormError error={ai.error} testID={`${testID}-error`} />;
}
