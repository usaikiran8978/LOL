import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { catalogApi, profileApi, type InterestCategory, type OwnProfile } from '../../api';
import { Button, ChipGroup, FormError, Text } from '../../components';
import { useAction } from '../../hooks/useAction';
import { useResource } from '../../hooks/useResource';
import { LoadState, type EditorProps } from './LoadState';

// Contract limit (interestsUpdate: max 20 ids).
const MAX = 20;

export function InterestsEditor(props: EditorProps) {
  const { i18n } = useTranslation();
  const profile = useResource(profileApi.me);
  const catalog = useResource(catalogApi.interests, [i18n.language]);
  return <LoadState resources={[profile, catalog]}>{() => <Editor {...props} profile={profile.data!} catalog={catalog.data!} />}</LoadState>;
}

function Editor({ profile, catalog, submitLabel, onSaved }: EditorProps & { profile: OwnProfile; catalog: InterestCategory[] }) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string[]>(profile.interestIds);
  const save = useAction(async () => {
    await profileApi.setInterests({ interestIds: selected });
    await onSaved();
  });
  // Selection spans categories; each group only edits its own ids.
  const onGroup = (ids: string[]) => (next: string[]) => setSelected((s) => [...s.filter((x) => !ids.includes(x)), ...next]);
  return (
    <>
      <Text color="textMuted" accessibilityLiveRegion="polite" style={{ marginBottom: 12 }} testID="interest-count">
        {t('interests.selected', { n: selected.length, max: MAX })}
      </Text>
      <FormError error={save.error} />
      {catalog.map((cat) => {
        const ids = cat.interests.map((i) => i.id);
        return (
          <ChipGroup
            key={cat.id}
            testID={`interests-${cat.key}`}
            label={cat.label}
            options={cat.interests.map((i) => ({ value: i.id, label: i.label }))}
            selected={selected.filter((s) => ids.includes(s))}
            onChange={onGroup(ids)}
            multiple
            max={MAX - selected.filter((s) => !ids.includes(s)).length}
          />
        );
      })}
      <Button testID="interests-save" label={submitLabel} onPress={() => void save.run()} loading={save.pending} />
    </>
  );
}
