import { profileUpdate } from '@amora/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { profileApi, type OwnProfile } from '../../api';
import { Button, FormError, TermPicker, TextField } from '../../components';
import { useAction } from '../../hooks/useAction';
import { useResource } from '../../hooks/useResource';
import { serverFieldErrors, validate, type FieldErrors } from '../../utils/validation';
import { LoadState, type EditorProps } from './LoadState';

const MESSAGES = { displayName: 'validation.displayName', bio: 'validation.bio', heightCm: 'validation.height', profession: 'validation.tooLong', employer: 'validation.tooLong', school: 'validation.tooLong' };

interface Values {
  displayName: string;
  bio: string;
  profession: string;
  employer: string;
  school: string;
  heightCm: string;
  educationLevelId: string | null;
}

const fromProfile = (p: OwnProfile): Values => ({
  displayName: p.displayName ?? '',
  bio: p.bio ?? '',
  profession: p.profession ?? '',
  employer: p.employer ?? '',
  school: p.school ?? '',
  heightCm: p.heightCm ? String(p.heightCm) : '',
  educationLevelId: p.educationLevel?.id ?? null,
});

export function ProfileBasicsForm(props: EditorProps) {
  const profile = useResource(profileApi.me);
  return <LoadState resources={[profile]}>{() => <Form {...props} profile={profile.data!} />}</LoadState>;
}

function Form({ profile, submitLabel, onSaved, registerDraft, draft }: EditorProps & { profile: OwnProfile }) {
  const { t } = useTranslation();
  const [values, setValues] = useState<Values>(() => ({ ...fromProfile(profile), ...((draft?.values as Partial<Values>) ?? {}) }));
  const [errors, setErrors] = useState<FieldErrors>({});
  useEffect(() => registerDraft?.(() => ({ values })), [registerDraft, values]);
  const set = (k: keyof Values) => (v: string) => setValues((s) => ({ ...s, [k]: v }));

  const save = useAction(async () => {
    const body = {
      displayName: values.displayName,
      bio: values.bio.trim() ? values.bio : null,
      profession: values.profession.trim() ? values.profession : null,
      employer: values.employer.trim() ? values.employer : null,
      school: values.school.trim() ? values.school : null,
      heightCm: values.heightCm ? Number(values.heightCm) : null,
      educationLevelId: values.educationLevelId,
    };
    const v = validate(profileUpdate, body, MESSAGES, t);
    setErrors(v.ok ? {} : v.errors);
    if (!v.ok) return;
    try {
      await profileApi.update(v.data);
    } catch (e) {
      setErrors(serverFieldErrors(e, MESSAGES, t));
      throw e;
    }
    await onSaved();
  });

  return (
    <>
      <FormError error={save.error} />
      <TextField testID="displayName" label={t('profile.fields.displayName')} hint={t('profile.fields.displayNameHint')} value={values.displayName} onChangeText={set('displayName')} maxLength={40} autoComplete="name-given" error={errors.displayName} />
      <TextField testID="bio" label={t('profile.fields.bio')} hint={t('profile.fields.bioHint', { length: values.bio.length, max: 1000 })} value={values.bio} onChangeText={set('bio')} multiline maxLength={1000} error={errors.bio} />
      <TextField testID="profession" label={t('profile.fields.profession')} value={values.profession} onChangeText={set('profession')} maxLength={100} error={errors.profession} />
      <TextField testID="employer" label={t('profile.fields.employer')} value={values.employer} onChangeText={set('employer')} maxLength={100} error={errors.employer} />
      <TermPicker kind="education_level" label={t('profile.fields.educationLevel')} value={values.educationLevelId ? [values.educationLevelId] : []} onChange={(ids) => setValues((s) => ({ ...s, educationLevelId: ids[0] ?? null }))} testID="education" />
      <TextField testID="school" label={t('profile.fields.school')} value={values.school} onChangeText={set('school')} maxLength={120} error={errors.school} />
      <TextField testID="height" label={t('profile.fields.heightCm')} value={values.heightCm} onChangeText={(v) => set('heightCm')(v.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={3} error={errors.heightCm} />
      <Button testID="basics-save" label={submitLabel} onPress={() => void save.run()} loading={save.pending} />
    </>
  );
}
