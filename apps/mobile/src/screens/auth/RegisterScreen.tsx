import { registerRequest } from '@amora/shared';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { analytics } from '../../analytics';
import { ApiError, authApi, isApiError } from '../../api';
import { getDeviceInfo } from '../../auth/device';
import { useSession } from '../../auth/SessionProvider';
import { Button, ChipGroup, FormError, Notice, Screen, TextField } from '../../components';
import { buildSignup, emptySignupDetails, SignupDetailsFields } from '../../features/auth/SignupDetailsFields';
import { useAction } from '../../hooks/useAction';
import { normalizePhone, serverFieldErrors, validate, type FieldErrors } from '../../utils/validation';

const MESSAGES = { email: 'validation.email', phone: 'validation.phone', password: 'validation.passwordLength' };

export default function RegisterScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { signIn } = useSession();
  const [method, setMethod] = useState<'email' | 'phone'>('email');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [details, setDetails] = useState(emptySignupDetails);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [legalNonce, setLegalNonce] = useState(0);
  const [ineligibleAge, setIneligibleAge] = useState<number | null>(null);

  useEffect(() => analytics.track('signup_started', { method: 'form' }), []);

  const submit = useAction(async () => {
    const signup = buildSignup(details, t);
    const payload = {
      ...(signup.ok ? signup.signup : {}),
      email: method === 'email' ? email.trim() : undefined,
      phone: method === 'phone' ? normalizePhone(phone) : undefined,
      password: method === 'email' || password ? password : undefined,
      device: await getDeviceInfo(),
    };
    const v = validate(registerRequest, payload, MESSAGES, t);
    // Signup-detail fields have their own messages (buildSignup); take only contact/password issues from the schema.
    const contactErrors = v.ok ? {} : Object.fromEntries(Object.entries(v.errors).filter(([k]) => ['email', 'phone', 'password'].includes(k)));
    setErrors({ ...contactErrors, ...(signup.ok ? {} : signup.errors) });
    if (!signup.ok) return;
    if (!v.ok) {
      if (Object.keys(contactErrors).length === 0) throw new ApiError('VALIDATION_FAILED', 400);
      return;
    }
    try {
      await signIn(await authApi.register(v.data));
    } catch (e) {
      if (isApiError(e, 'AGE_INELIGIBLE')) return setIneligibleAge(e.detail<number>('minAge') ?? null);
      if (isApiError(e, 'CONSENT_REQUIRED')) setLegalNonce((n) => n + 1); // a newer document version was published
      if (isApiError(e, 'EMAIL_TAKEN')) setErrors({ email: t('errors.EMAIL_TAKEN') });
      if (isApiError(e, 'PHONE_TAKEN')) setErrors({ phone: t('errors.PHONE_TAKEN') });
      setErrors((prev) => ({ ...prev, ...serverFieldErrors(e, { ...MESSAGES, dateOfBirth: 'validation.dateOfBirth' }, t) }));
      throw e;
    }
  });

  if (ineligibleAge !== null) {
    return (
      <Screen title={t('auth.register.ineligibleTitle')} testID="register-ineligible">
        <Notice tone="warning" title={t('errors.AGE_INELIGIBLE', { minAge: ineligibleAge })} body={t('auth.register.ineligibleBody')} />
        <Button label={t('common.backToStart')} onPress={() => router.replace('/welcome')} />
      </Screen>
    );
  }

  return (
    <Screen
      title={t('auth.register.title')}
      testID="register-screen"
      footer={<Button testID="register-submit" label={t('auth.register.submit')} onPress={() => void submit.run()} loading={submit.pending} />}
    >
      <FormError error={submit.error} />
      <ChipGroup
        label={t('auth.register.method')}
        options={[
          { value: 'email', label: t('auth.email') },
          { value: 'phone', label: t('auth.phone') },
        ]}
        selected={[method]}
        onChange={(v) => v[0] && setMethod(v[0] as 'email' | 'phone')}
        testID="register-method"
      />
      {method === 'email' ? (
        <TextField testID="register-email" label={t('auth.email')} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" textContentType="emailAddress" error={errors.email} />
      ) : (
        <TextField testID="register-phone" label={t('auth.phone')} hint={t('auth.phoneHint')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" error={errors.phone} />
      )}
      <TextField
        testID="register-password"
        label={method === 'email' ? t('auth.password') : t('auth.passwordOptional')}
        hint={t('auth.passwordHint', { min: 10 })}
        value={password}
        onChangeText={setPassword}
        secureToggle
        autoComplete="new-password"
        textContentType="newPassword"
        error={errors.password}
      />
      <SignupDetailsFields value={details} onChange={setDetails} errors={errors} legalNonce={legalNonce} />
      <Button variant="ghost" label={t('auth.register.haveAccount')} onPress={() => router.replace('/login')} />
    </Screen>
  );
}
