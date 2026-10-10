import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { catalogApi, profileApi, type Language, type LanguageProficiency, type OwnProfile } from '../../api';
import { Button, ChipGroup, FormError, Select, Text } from '../../components';
import { useAction } from '../../hooks/useAction';
import { useResource } from '../../hooks/useResource';
import { useTheme } from '../../theme/ThemeProvider';
import { LoadState, type EditorProps } from './LoadState';

const PROFICIENCIES: LanguageProficiency[] = ['native', 'fluent', 'conversational', 'learning'];
const MAX = 10; // languagesUpdate contract limit

export function LanguagesEditor(props: EditorProps) {
  const profile = useResource(profileApi.me);
  const catalog = useResource(catalogApi.languages);
  return <LoadState resources={[profile, catalog]}>{() => <Editor {...props} profile={profile.data!} catalog={catalog.data!} />}</LoadState>;
}

function Editor({ profile, catalog, submitLabel, onSaved }: EditorProps & { profile: OwnProfile; catalog: Language[] }) {
  const { t } = useTranslation();
  const { spacing, colors, radius } = useTheme();
  const [items, setItems] = useState(profile.languages);
  const name = (code: string) => catalog.find((l) => l.code === code)?.nativeName ?? code;
  const save = useAction(async () => {
    await profileApi.setLanguages({ languages: items });
    await onSaved();
  });
  const remaining = catalog.filter((l) => !items.some((i) => i.code === l.code));

  return (
    <>
      <FormError error={save.error} />
      {items.length === 0 ? <Text color="textMuted" style={{ marginBottom: spacing.md }}>{t('languages.none')}</Text> : null}
      {items.map((item) => (
        <View key={item.code} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md }}>
          <Text variant="heading">{name(item.code)}</Text>
          <ChipGroup
            label={t('languages.proficiency')}
            options={PROFICIENCIES.map((p) => ({ value: p, label: t(`languages.levels.${p}`) }))}
            selected={[item.proficiency]}
            onChange={(v) => v[0] && setItems((s) => s.map((x) => (x.code === item.code ? { ...x, proficiency: v[0] as LanguageProficiency } : x)))}
            testID={`lang-${item.code}-level`}
          />
          <Button variant="ghost" label={t('languages.remove', { name: name(item.code) })} onPress={() => setItems((s) => s.filter((x) => x.code !== item.code))} />
        </View>
      ))}
      {items.length < MAX ? (
        <Select
          testID="language-add"
          label={t('languages.add')}
          value={null}
          options={remaining.map((l) => ({ value: l.code, label: l.nativeName, description: l.name }))}
          onChange={(code) => setItems((s) => [...s, { code, proficiency: 'fluent' }])}
          searchable
        />
      ) : null}
      <Button testID="languages-save" label={submitLabel} onPress={() => void save.run()} loading={save.pending} />
    </>
  );
}
