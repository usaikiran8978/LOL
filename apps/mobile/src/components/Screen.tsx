import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError } from '../api/errors';
import { useErrorText } from '../hooks/useErrorText';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from './Button';
import { LoveBackground } from './LoveBackground';
import { Text } from './Text';

export type ScreenStatus = 'loading' | 'error' | 'empty' | 'ready';

export interface ScreenProps {
  title?: string;
  subtitle?: string;
  status?: ScreenStatus;
  error?: unknown;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyBody?: string;
  emptyAction?: { label: string; onPress: () => void };
  /** Pinned below the scroll area (primary actions). */
  footer?: ReactNode;
  header?: ReactNode;
  scroll?: boolean;
  /** Drifting hearts/sparkles behind the content — key moments only (onboarding, celebrations). */
  decorated?: boolean;
  testID?: string;
  children?: ReactNode;
}

/** Page shell: safe areas, keyboard avoidance, and the standard loading / empty / error states. */
export function Screen({ title, subtitle, status = 'ready', error, onRetry, emptyTitle, emptyBody, emptyAction, footer, header, scroll = true, decorated, testID, children }: ScreenProps) {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const errorText = useErrorText();

  let body: ReactNode;
  if (status === 'loading') {
    body = (
      <View style={styles.center} accessible accessibilityRole="progressbar" accessibilityLabel={t('common.loading')} testID="screen-loading">
        <ActivityIndicator size="large" color={colors.primary} />
        <Text color="textMuted" style={{ marginTop: spacing.md }}>
          {t('common.loading')}
        </Text>
      </View>
    );
  } else if (status === 'error') {
    body = (
      <View style={styles.center} testID="screen-error">
        <Text variant="heading" align="center">
          {t('common.errorTitle')}
        </Text>
        <Text color="textMuted" align="center" accessibilityRole="alert" style={{ marginVertical: spacing.md }}>
          {errorText(error) ?? t('errors.INTERNAL')}
        </Text>
        {error instanceof ApiError && error.requestId ? (
          <Text variant="caption" color="textMuted" align="center" style={{ marginBottom: spacing.md }}>
            {t('errors.reference', { id: error.requestId })}
          </Text>
        ) : null}
        {onRetry ? <Button label={t('common.retry')} onPress={onRetry} variant="secondary" testID="screen-retry" /> : null}
      </View>
    );
  } else if (status === 'empty') {
    body = (
      <View style={styles.center} testID="screen-empty">
        <Text variant="heading" align="center">
          {emptyTitle ?? t('common.emptyTitle')}
        </Text>
        {emptyBody ? (
          <Text color="textMuted" align="center" style={{ marginTop: spacing.sm }}>
            {emptyBody}
          </Text>
        ) : null}
        {emptyAction ? <Button label={emptyAction.label} onPress={emptyAction.onPress} style={{ marginTop: spacing.lg }} /> : null}
      </View>
    );
  } else {
    body = children;
  }

  const heading = title ? (
    <View style={{ marginBottom: spacing.lg }}>
      <Text variant="display">{title}</Text>
      {subtitle ? (
        <Text color="textMuted" style={{ marginTop: spacing.xs }}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  ) : null;

  const content = (
    <>
      {header}
      {heading}
      {body}
    </>
  );

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.background }]} edges={['top', 'bottom', 'left', 'right']} testID={testID}>
      {decorated ? <LoveBackground /> : null}
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {scroll ? (
          <ScrollView contentContainerStyle={{ padding: spacing.lg, flexGrow: 1 }} keyboardShouldPersistTaps="handled">
            {content}
          </ScrollView>
        ) : (
          <View style={[styles.flex, { padding: spacing.lg }]}>{content}</View>
        )}
        {footer && status === 'ready' ? <View style={{ padding: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, gap: spacing.sm }}>{footer}</View> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 48 },
});
