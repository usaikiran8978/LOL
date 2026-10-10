import type { TaxonomyKind } from '@amora/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { profileApi, type OwnProfile } from '../../api';
import { Button, FormError, Notice, TermPicker } from '../../components';
import { useAction } from '../../hooks/useAction';
import { useResource } from '../../hooks/useResource';
import { LoadState, type EditorProps } from './LoadState';

/** Single-choice identity fields stored on the profile row. */
export const IDENTITY_FIELDS = {
  gender: { field: 'genderId', profileKey: 'gender' },
  orientation: { field: 'orientationId', profileKey: 'orientation' },
  dating_intent: { field: 'datingIntentId', profileKey: 'datingIntent' },
  relationship_goal: { field: 'relationshipGoalId', profileKey: 'relationshipGoal' },
  relationship_status: { field: 'relationshipStatusId', profileKey: 'relationshipStatus' },
} as const satisfies Partial<Record<TaxonomyKind, { field: string; profileKey: keyof OwnProfile }>>;
export type IdentityKind = keyof typeof IDENTITY_FIELDS;

export function IdentityTermEditor({ kind, ...props }: EditorProps & { kind: IdentityKind }) {
  const profile = useResource(profileApi.me);
  return <LoadState resources={[profile]}>{() => <Editor {...props} kind={kind} profile={profile.data!} />}</LoadState>;
}

function Editor({ kind, profile, submitLabel, onSaved }: EditorProps & { kind: IdentityKind; profile: OwnProfile }) {
  const { t } = useTranslation();
  const { field, profileKey } = IDENTITY_FIELDS[kind];
  const current = (profile[profileKey] as { id: string } | null)?.id;
  const [value, setValue] = useState<string[]>(current ? [current] : []);
  const [error, setError] = useState<string | null>(null);
  const save = useAction(async () => {
    if (!value[0]) return setError(t('validation.chooseOne'));
    setError(null);
    await profileApi.update({ [field]: value[0] });
    await onSaved();
  });
  return (
    <>
      {kind === 'orientation' ? <Notice title={t('profile.sensitiveTitle')} body={t('profile.sensitiveBody')} /> : null}
      <FormError error={save.error} />
      <TermPicker kind={kind} label={t(`profile.terms.${kind}`)} value={value} onChange={setValue} error={error} testID={`term-${kind}`} />
      <Button testID="term-save" label={submitLabel} onPress={() => void save.run()} loading={save.pending} />
    </>
  );
}
