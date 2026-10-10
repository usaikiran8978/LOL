import { loginRequest } from '@amora/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { authApi } from '../../api';
import { getDeviceInfo } from '../../auth/device';
import { useSession } from '../../auth/SessionProvider';
import { Button, FormError, Screen, TextField } from '../../components';
import { useAction } from '../../hooks/useAction';
import { useTheme } from '../../theme/ThemeProvider';
import { looksLikeEmail, normalizePhone, validate, type FieldErrors } from '../../utils/validation';

const MESSAGES = { identifier: 'validation.identifier', password: 'validation.required' };

export default function LoginScreen() {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const router = useRouter();
  const { signIn } = useSession();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const submit = useAction(async () => {
    const id = looksLikeEmail(identifier) ? identifier.trim() : normalizePhone(identifier);
    const device = await getDeviceInfo();
    const v = validate(loginRequest, { identifier: id, password, device }, MESSAGES, t);
    setErrors(v.ok ? {} : v.errors);
    if (!v.ok) return;
    await signIn(await authApi.login(v.data));
  });

  return (
    <Screen
      title={t('auth.login.title')}
      testID="login-screen"
      footer={<Button testID="login-submit" label={t('auth.login.submit')} onPress={() => void submit.run()} loading={submit.pending} />}
    >
      <FormError error={submit.error} />
      <TextField
        testID="login-identifier"
        label={t('auth.login.identifier')}
        hint={t('auth.login.identifierHint')}
        value={identifier}
        onChangeText={setIdentifier}
        autoCapitalize="none"
        autoComplete="username"
        textContentType="username"
        keyboardType="email-address"
        error={errors.identifier}
      />
      <TextField
        testID="login-password"
        label={t('auth.password')}
        value={password}
        onChangeText={setPassword}
        secureToggle
        autoComplete="current-password"
        textContentType="password"
        error={errors.password}
        onSubmitEditing={() => void submit.run()}
      />
      <View style={{ gap: spacing.xs }}>
        <Button variant="ghost" label={t('auth.login.forgot')} onPress={() => router.push('/forgot-password')} />
        <Button variant="ghost" label={t('auth.login.phoneCode')} onPress={() => router.push('/phone-login')} />
        <Button variant="ghost" label={t('auth.login.recover')} onPress={() => router.push('/recovery')} />
        <Button variant="ghost" label={t('auth.login.noAccount')} onPress={() => router.replace('/register')} />
      </View>
    </Screen>
  );
}
