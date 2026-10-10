import { useRouter } from 'expo-router';
import { useState, type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { ChipGroup, Screen, useToast } from '../../components';
import { ATTRIBUTE_GROUPS, AttributesEditor, type AttributeGroup } from '../../features/profile/AttributesEditor';
import { IDENTITY_FIELDS, IdentityTermEditor, type IdentityKind } from '../../features/profile/IdentityTermEditor';
import { InterestsEditor } from '../../features/profile/InterestsEditor';
import { LanguagesEditor } from '../../features/profile/LanguagesEditor';
import type { EditorProps } from '../../features/profile/LoadState';
import { LocationEditor } from '../../features/profile/LocationEditor';
import { MediaManager } from '../../features/profile/MediaManager';
import { PreferencesEditor } from '../../features/profile/PreferencesEditor';
import { ProfileBasicsForm } from '../../features/profile/ProfileBasicsForm';
import { PromptsEditor } from '../../features/profile/PromptsEditor';

/** Wraps an editor as a standalone screen: "Save" → toast → back. */
function editScreen(titleKey: string, Editor: ComponentType<EditorProps>, testID: string, doneKey = 'common.save') {
  return function EditScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const toast = useToast();
    return (
      <Screen title={t(titleKey)} testID={testID}>
        <Editor
          submitLabel={t(doneKey)}
          onSaved={() => {
            toast.show(t('common.saved'), 'success');
            router.back();
          }}
        />
      </Screen>
    );
  };
}

export const EditBasicsScreen = editScreen('profile.sections.about', ProfileBasicsForm, 'edit-basics');
export const EditInterestsScreen = editScreen('profile.sections.interests', InterestsEditor, 'edit-interests');
export const EditLanguagesScreen = editScreen('profile.sections.languages', LanguagesEditor, 'edit-languages');
export const EditPromptsScreen = editScreen('profile.sections.prompts', PromptsEditor, 'edit-prompts');
export const EditMediaScreen = editScreen('profile.sections.photos', MediaManager, 'edit-media', 'common.done');
export const EditLocationScreen = editScreen('profile.sections.location', LocationEditor, 'edit-location');
export const EditPreferencesScreen = editScreen('settings.preferences', PreferencesEditor, 'edit-preferences');

/** Identity fields: one picker at a time, chosen from a selector. */
export function EditIdentityScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const toast = useToast();
  const kinds = Object.keys(IDENTITY_FIELDS) as IdentityKind[];
  const [kind, setKind] = useState<IdentityKind>('gender');
  return (
    <Screen title={t('profile.sections.identity')} testID="edit-identity">
      <ChipGroup label={t('profile.chooseField')} options={kinds.map((k) => ({ value: k, label: t(`profile.terms.${k}`) }))} selected={[kind]} onChange={(v) => v[0] && setKind(v[0] as IdentityKind)} />
      <IdentityTermEditor key={kind} kind={kind} submitLabel={t('common.save')} onSaved={() => toast.show(t('common.saved'), 'success')} />
    </Screen>
  );
}

/** All attribute groups (lifestyle, family, values, communication, more) as tabs. */
export function EditAttributesScreen() {
  const { t } = useTranslation();
  const toast = useToast();
  const groups = Object.keys(ATTRIBUTE_GROUPS) as AttributeGroup[];
  const [group, setGroup] = useState<AttributeGroup>('lifestyle');
  return (
    <Screen title={t('profile.sections.attributes')} testID="edit-attributes">
      <ChipGroup label={t('profile.chooseField')} options={groups.map((g) => ({ value: g, label: t(`profile.attributeGroups.${g}`) }))} selected={[group]} onChange={(v) => v[0] && setGroup(v[0] as AttributeGroup)} />
      <AttributesEditor key={group} group={group} kinds={ATTRIBUTE_GROUPS[group]} submitLabel={t('common.save')} onSaved={() => toast.show(t('common.saved'), 'success')} />
    </Screen>
  );
}
