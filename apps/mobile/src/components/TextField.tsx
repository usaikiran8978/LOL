import { forwardRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { CONTROL_HEIGHT, MIN_TOUCH } from '../theme/tokens';
import { Text } from './Text';

export interface TextFieldProps extends Omit<TextInputProps, 'style' | 'placeholderTextColor'> {
  label: string;
  error?: string | null;
  hint?: string;
  /** Adds a show/hide toggle for password fields. */
  secureToggle?: boolean;
}

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, error, hint, secureToggle, secureTextEntry, multiline, testID, ...rest },
  ref,
) {
  const { t } = useTranslation();
  const { colors, radius, spacing, typography } = useTheme();
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(true);
  const secure = secureToggle ? hidden : secureTextEntry;
  const borderColor = error ? colors.danger : focused ? colors.focus : colors.borderStrong;

  return (
    <View style={{ marginBottom: spacing.lg }}>
      <Text variant="label" style={{ marginBottom: spacing.xs }} nativeID={testID ? `${testID}-label` : undefined}>
        {label}
      </Text>
      <View style={[styles.box, { borderColor, borderRadius: radius.md, backgroundColor: colors.background, minHeight: multiline ? 96 : CONTROL_HEIGHT }]}>
        <TextInput
          ref={ref}
          testID={testID}
          accessibilityLabel={label}
          accessibilityHint={error ?? hint}
          accessibilityState={{ disabled: rest.editable === false }}
          secureTextEntry={secure}
          multiline={multiline}
          placeholderTextColor={colors.textMuted}
          onFocus={(e) => {
            setFocused(true);
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            rest.onBlur?.(e);
          }}
          style={[typography.body, styles.input, { color: colors.text, paddingHorizontal: spacing.md, textAlignVertical: multiline ? 'top' : 'center' }]}
          {...rest}
        />
        {secureToggle ? (
          <Pressable
            onPress={() => setHidden((h) => !h)}
            accessibilityRole="button"
            accessibilityLabel={hidden ? t('common.showPassword') : t('common.hidePassword')}
            style={[styles.toggle, { paddingHorizontal: spacing.md }]}
          >
            <Text variant="label" color="primary">
              {hidden ? t('common.show') : t('common.hide')}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <Text variant="caption" color="danger" accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ marginTop: spacing.xs }}>
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" color="textMuted" style={{ marginTop: spacing.xs }}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'stretch', borderWidth: 1.5 },
  input: { flex: 1, paddingVertical: 10 },
  toggle: { minWidth: MIN_TOUCH, minHeight: MIN_TOUCH, justifyContent: 'center', alignItems: 'center' },
});
