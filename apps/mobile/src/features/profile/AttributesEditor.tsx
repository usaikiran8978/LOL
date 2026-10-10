import { MULTI_ATTRIBUTE_KINDS, PROFILE_ATTRIBUTE_KINDS } from '@amora/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { catalogApi, profileApi, type OwnProfile, type Term } from '../../api';
import { Button, FormError, Notice, TermPicker } from '../../components';
import { useAction } from '../../hooks/useAction';
import { useResource } from '../../hooks/useResource';
import { LoadState, type EditorProps } from './LoadState';

export type AttributeKind = (typeof PROFILE_ATTRIBUTE_KINDS)[number];

/** Onboarding step key → attribute kinds it collects (mirrors the API's step checks). */
export const ATTRIBUTE_GROUPS = {
  lifestyle: ['lifestyle_drinking', 'lifestyle_smoking', 'lifestyle_cannabis', 'lifestyle_exercise', 'lifestyle_diet', 'lifestyle_sleep', 'lifestyle_social', 'pets'],
  family: ['children_have', 'children_want', 'family_plans'],
  values: ['religion', 'religion_importance', 'politics'],
  communication_style: ['communication_style', 'love_language'],
  more: ['travel_style', 'zodiac'],
} as const satisfies Record<string, readonly AttributeKind[]>;
export type AttributeGroup = keyof typeof ATTRIBUTE_GROUPS;

const SENSITIVE_GROUPS = new Set<AttributeGroup>(['values']);

export function AttributesEditor({ kinds, group, ...props }: EditorProps & { kinds: readonly AttributeKind[]; group?: AttributeGroup }) {
  const { i18n } = useTranslation();
  const profile = useResource(profileApi.me);
  const terms = useResource(() => catalogApi.taxonomy(kinds), [kinds.join(','), i18n.language]);
  return <LoadState resources={[profile, terms]}>{() => <Editor {...props} kinds={kinds} group={group} profile={profile.data!} terms={terms.data!} />}</LoadState>;
}

function Editor({ kinds, group, profile, terms, submitLabel, onSaved }: EditorProps & { kinds: readonly AttributeKind[]; group?: AttributeGroup; profile: OwnProfile; terms: Term[] }) {
  const { t } = useTranslation();
  const [values, setValues] = useState<Partial<Record<AttributeKind, string[]>>>(() =>
    Object.fromEntries(kinds.map((k) => [k, (profile.attributes[k] ?? []).map((x) => x.id)])),
  );
  const save = useAction(async () => {
    // Full replacement per kind sent; untouched kinds are omitted so they stay as they are.
    await profileApi.setAttributes({ attributes: values });
    await onSaved();
  });
  return (
    <>
      {group && SENSITIVE_GROUPS.has(group) ? <Notice title={t('profile.sensitiveTitle')} body={t('profile.sensitiveBody')} /> : null}
      <FormError error={save.error} />
      {kinds.map((k) => {
        const multiple = MULTI_ATTRIBUTE_KINDS.includes(k);
        return (
          <TermPicker
            key={k}
            kind={k}
            terms={terms}
            label={t(`profile.terms.${k}`)}
            hint={multiple ? t('common.chooseAny') : undefined}
            multiple={multiple}
            max={10}
            value={values[k] ?? []}
            onChange={(ids) => setValues((s) => ({ ...s, [k]: ids }))}
            testID={`attr-${k}`}
          />
        );
      })}
      <Button testID="attributes-save" label={submitLabel} onPress={() => void save.run()} loading={save.pending} />
    </>
  );
}
