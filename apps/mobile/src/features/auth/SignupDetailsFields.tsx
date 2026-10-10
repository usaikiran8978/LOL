import { getCalendars, getLocales } from 'expo-localization';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';
import { catalogApi, legalApi, type LegalDocType } from '../../api';
import { Button, Checkbox, DateField, Select, Text, ToggleRow } from '../../components';
import { useResource } from '../../hooks/useResource';
import i18n from '../../i18n';
import { useTheme } from '../../theme/ThemeProvider';
import { ageOn, DEFAULT_MIN_AGE } from '../../utils/age';
import type { FieldErrors } from '../../utils/validation';

export interface SignupDetails {
  dateOfBirth: string;
  countryCode: string | null;
  termsId: string | null;
  privacyId: string | null;
  termsAccepted: boolean;
  privacyAccepted: boolean;
  confirmsMinimumAge: boolean;
  marketingOptIn: boolean;
}

export const emptySignupDetails = (): SignupDetails => ({
  dateOfBirth: '',
  countryCode: getLocales()[0]?.regionCode ?? null,
  termsId: null,
  privacyId: null,
  termsAccepted: false,
  privacyAccepted: false,
  confirmsMinimumAge: false,
  marketingOptIn: false,
});

/** Validates the details and builds the `signup` part shared by register and social sign-up requests. */
export function buildSignup(v: SignupDetails, t: (k: string, p?: Record<string, unknown>) => string) {
  const errors: FieldErrors = {};
  if (!v.dateOfBirth) errors.dateOfBirth = t('validation.dateOfBirth');
  else if (ageOn(v.dateOfBirth) < DEFAULT_MIN_AGE) errors.dateOfBirth = t('validation.tooYoung', { minAge: DEFAULT_MIN_AGE });
  if (!v.countryCode) errors.countryCode = t('validation.required');
  if (!v.termsId || !v.termsAccepted) errors.terms = t('validation.acceptTerms');
  if (!v.privacyId || !v.privacyAccepted) errors.privacy = t('validation.acceptPrivacy');
  if (!v.confirmsMinimumAge) errors.confirmsMinimumAge = t('validation.confirmAge');
  if (Object.keys(errors).length) return { ok: false as const, errors };
  return {
    ok: true as const,
    signup: {
      dateOfBirth: v.dateOfBirth,
      countryCode: v.countryCode!,
      locale: i18n.language,
      timezone: getCalendars()[0]?.timeZone ?? undefined,
      acceptedTermsVersionId: v.termsId!,
      acceptedPrivacyVersionId: v.privacyId!,
      confirmsMinimumAge: true as const,
      marketingOptIn: v.marketingOptIn,
    },
  };
}

interface Props {
  value: SignupDetails;
  onChange: (next: SignupDetails) => void;
  errors: FieldErrors;
  /** Bump to refetch legal documents (e.g. after CONSENT_REQUIRED: a newer version was published). */
  legalNonce?: number;
}

/** DOB age gate, country, Terms/Privacy acceptance (version-pinned ids) and marketing opt-in. */
export function SignupDetailsFields({ value, onChange, errors, legalNonce = 0 }: Props) {
  const { t, i18n: i } = useTranslation();
  const { spacing, colors } = useTheme();
  const router = useRouter();
  const countries = useResource(catalogApi.countries);
  const country = value.countryCode && countries.data?.some((c) => c.code === value.countryCode) ? value.countryCode : undefined;
  const legal = useResource(
    () => Promise.all([legalApi.get('terms', country), legalApi.get('privacy', country)]),
    [country, i.language, legalNonce],
    countries.status !== 'loading',
  );
  const [terms, privacy] = legal.data ?? [];

  // Acceptance is tied to a specific document version; a different version (country/locale change) must be re-accepted.
  useEffect(() => {
    if (!terms || !privacy) return;
    if (terms.id !== value.termsId || privacy.id !== value.privacyId) {
      onChange({ ...value, termsId: terms.id, privacyId: privacy.id, termsAccepted: terms.id === value.termsId && value.termsAccepted, privacyAccepted: privacy.id === value.privacyId && value.privacyAccepted });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terms?.id, privacy?.id]);

  const set = <K extends keyof SignupDetails>(k: K, v: SignupDetails[K]) => onChange({ ...value, [k]: v });
  const open = (type: LegalDocType) => router.push({ pathname: '/legal/[type]', params: { type, country: country ?? '' } });

  return (
    <View>
      <DateField label={t('auth.signup.dateOfBirth')} hint={t('auth.signup.dateOfBirthHint')} value={value.dateOfBirth} onChange={(v) => set('dateOfBirth', v)} error={errors.dateOfBirth} testID="dob" />

      {countries.status === 'error' ? (
        <View style={{ marginBottom: spacing.lg }}>
          <Text color="danger" accessibilityRole="alert">
            {t('auth.signup.countriesFailed')}
          </Text>
          <Button label={t('common.retry')} variant="ghost" onPress={countries.reload} />
        </View>
      ) : (
        <Select
          label={t('auth.signup.country')}
          value={country ?? null}
          options={(countries.data ?? []).map((c) => ({ value: c.code, label: c.name }))}
          onChange={(v) => set('countryCode', v)}
          placeholder={countries.status === 'loading' ? t('common.loading') : t('auth.signup.countryPlaceholder')}
          disabled={countries.status === 'loading'}
          searchable
          error={errors.countryCode}
          testID="country"
        />
      )}

      <Text variant="heading" style={{ marginBottom: spacing.sm }}>
        {t('auth.signup.legalHeading')}
      </Text>
      {legal.status === 'loading' ? (
        <ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} style={{ marginBottom: spacing.lg }} />
      ) : legal.status === 'error' ? (
        <View style={{ marginBottom: spacing.lg }}>
          <Text color="danger" accessibilityRole="alert">
            {t('auth.signup.legalFailed')}
          </Text>
          <Button label={t('common.retry')} variant="ghost" onPress={legal.reload} />
        </View>
      ) : (
        <>
          <Checkbox testID="accept-terms" label={t('auth.signup.acceptTerms', { version: terms?.version })} checked={value.termsAccepted} onChange={(v) => set('termsAccepted', v)} error={errors.terms}>
            <Button variant="ghost" label={t('auth.signup.readDocument', { title: terms?.title })} onPress={() => open('terms')} />
          </Checkbox>
          <Checkbox testID="accept-privacy" label={t('auth.signup.acceptPrivacy', { version: privacy?.version })} checked={value.privacyAccepted} onChange={(v) => set('privacyAccepted', v)} error={errors.privacy}>
            <Button variant="ghost" label={t('auth.signup.readDocument', { title: privacy?.title })} onPress={() => open('privacy')} />
          </Checkbox>
        </>
      )}
      <Checkbox testID="confirm-age" label={t('auth.signup.confirmAge')} checked={value.confirmsMinimumAge} onChange={(v) => set('confirmsMinimumAge', v)} error={errors.confirmsMinimumAge} />
      <ToggleRow testID="marketing" label={t('auth.signup.marketing')} description={t('auth.signup.marketingHint')} value={value.marketingOptIn} onChange={(v) => set('marketingOptIn', v)} />
    </View>
  );
}
