import { changePasswordRequest } from '@amora/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { authApi, isApiError } from '../../api';
import { Button, FormError, Notice, Screen, TextField, useToast } from '../../components';
import { useAction } from '../../hooks/useAction';
import { validate, type FieldErrors } from '../../utils/validation';

export default function ChangePasswordScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});

  const submit = useAction(async () => {
    const v = validate(changePasswordRequest, { currentPassword: current, newPassword: next }, { currentPassword: 'validation.required', newPassword: 'validation.passwordLength' }, t);
    const errs: FieldErrors = v.ok ? {} : { ...v.errors };
    if (next !== confirm) errs.confirm = t('validation.passwordMismatch');
    setErrors(errs);
    if (!v.ok || Object.keys(errs).length) return;
    try {
      await authApi.changePassword(v.data);
    } catch (e) {
      if (isApiError(e, 'INVALID_CREDENTIALS')) return setErrors({ currentPassword: t('settings.password.wrongCurrent') });
      throw e;
    }
    toast.show(t('settings.password.done'), 'success');
    router.back();
  });

  return (
    <Screen title={t('settings.changePassword')} testID="password-screen" footer={<Button testID="password-submit" label={t('common.save')} onPress={() => void submit.run()} loading={submit.pending} />}>
      <Notice title={t('settings.password.othersSignedOut')} />
      <FormError error={submit.error} />
      <TextField testID="password-current" label={t('settings.password.current')} hint={t('settings.password.currentHint')} value={current} onChangeText={setCurrent} secureToggle autoComplete="current-password" error={errors.currentPassword} />
      <TextField testID="password-new" label={t('auth.newPassword')} hint={t('auth.passwordHint', { min: 10 })} value={next} onChangeText={setNext} secureToggle autoComplete="new-password" error={errors.newPassword} />
      <TextField testID="password-confirm" label={t('auth.confirmPassword')} value={confirm} onChangeText={setConfirm} secureToggle autoComplete="new-password" error={errors.confirm} />
    </Screen>
  );
}
