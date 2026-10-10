import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { CONTROL_HEIGHT, MIN_TOUCH } from '../theme/tokens';
import { Button } from './Button';
import { Text } from './Text';
import { TextField } from './TextField';

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
}

export interface SelectProps {
  label: string;
  value: string | null;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  searchable?: boolean;
  error?: string | null;
  disabled?: boolean;
  testID?: string;
}

/** Single-choice picker presented as a full-screen list (works for long lists such as countries). */
export function Select({ label, value, options, onChange, placeholder, searchable, error, disabled, testID }: SelectProps) {
  const { t } = useTranslation();
  const { colors, radius, spacing } = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = options.find((o) => o.value === value);
  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return q ? options.filter((o) => o.label.toLocaleLowerCase().includes(q)) : options;
  }, [options, query]);

  return (
    <View style={{ marginBottom: spacing.lg }}>
      <Text variant="label" style={{ marginBottom: spacing.xs }}>
        {label}
      </Text>
      <Pressable
        testID={testID}
        disabled={disabled}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${selected?.label ?? placeholder ?? t('common.select')}`}
        accessibilityHint={error ?? t('common.opensPicker')}
        accessibilityState={{ disabled: !!disabled, expanded: open }}
        style={[styles.field, { borderColor: error ? colors.danger : colors.borderStrong, borderRadius: radius.md, paddingHorizontal: spacing.md, opacity: disabled ? 0.5 : 1 }]}
      >
        <Text color={selected ? 'text' : 'textMuted'} style={{ flex: 1 }}>
          {selected?.label ?? placeholder ?? t('common.select')}
        </Text>
        <Text color="textMuted" importantForAccessibility="no">
          ▾
        </Text>
      </Pressable>
      {error ? (
        <Text variant="caption" color="danger" accessibilityRole="alert" style={{ marginTop: spacing.xs }}>
          {error}
        </Text>
      ) : null}
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.background, padding: spacing.lg }}>
          <Text variant="title" style={{ marginBottom: spacing.md }}>
            {label}
          </Text>
          {searchable ? <TextField label={t('common.search')} value={query} onChangeText={setQuery} autoCorrect={false} testID={testID ? `${testID}-search` : undefined} /> : null}
          <FlatList
            data={filtered}
            keyExtractor={(o) => o.value}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={<Text color="textMuted">{t('common.noResults')}</Text>}
            renderItem={({ item }) => {
              const on = item.value === value;
              return (
                <Pressable
                  testID={testID ? `${testID}-option-${item.value}` : undefined}
                  onPress={() => {
                    onChange(item.value);
                    setOpen(false);
                    setQuery('');
                  }}
                  accessibilityRole="radio"
                  accessibilityLabel={item.label}
                  accessibilityHint={item.description}
                  accessibilityState={{ checked: on }}
                  style={[styles.option, { borderBottomColor: colors.border, paddingVertical: spacing.md }]}
                >
                  <View style={{ flex: 1 }}>
                    <Text variant={on ? 'label' : 'body'} color={on ? 'primary' : 'text'}>
                      {item.label}
                    </Text>
                    {item.description ? (
                      <Text variant="caption" color="textMuted">
                        {item.description}
                      </Text>
                    ) : null}
                  </View>
                  {on ? <Text color="primary" importantForAccessibility="no">✓</Text> : null}
                </Pressable>
              );
            }}
          />
          <Button label={t('common.close')} variant="secondary" onPress={() => setOpen(false)} style={{ marginTop: spacing.md }} />
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { minHeight: CONTROL_HEIGHT, borderWidth: 1.5, flexDirection: 'row', alignItems: 'center' },
  option: { minHeight: MIN_TOUCH, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
});
