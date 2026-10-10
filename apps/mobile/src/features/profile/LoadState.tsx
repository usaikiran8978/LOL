import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';
import { Button, Text } from '../../components';
import { useErrorText } from '../../hooks/useErrorText';
import type { Resource } from '../../hooks/useResource';
import { useTheme } from '../../theme/ThemeProvider';

/** Inline loading / error-with-retry for editors embedded in a screen. Renders children once every resource is ready. */
export function LoadState({ resources, children }: { resources: Array<Pick<Resource<unknown>, 'status' | 'data' | 'error' | 'reload'>>; children: () => ReactNode }) {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const errorText = useErrorText();
  const failed = resources.find((r) => r.status === 'error' && r.data === undefined);
  if (failed) {
    return (
      <View testID="editor-error" style={{ paddingVertical: spacing.xl, alignItems: 'center' }}>
        <Text color="danger" align="center" accessibilityRole="alert">
          {errorText(failed.error)}
        </Text>
        <Button variant="secondary" label={t('common.retry')} onPress={() => resources.filter((r) => r.status === 'error').forEach((r) => r.reload())} style={{ marginTop: spacing.md }} />
      </View>
    );
  }
  if (resources.some((r) => r.data === undefined)) {
    return (
      <View testID="editor-loading" accessible accessibilityLabel={t('common.loading')} style={{ paddingVertical: spacing.xl }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  return <>{children()}</>;
}

export interface EditorProps {
  /** Label of the primary action ("Continue" in onboarding, "Save" when editing). */
  submitLabel: string;
  onSaved: () => void | Promise<void>;
  /** Onboarding: lets the engine persist unsaved input as a server-side draft. */
  registerDraft?: (getter: () => Record<string, unknown>) => void;
  draft?: Record<string, unknown> | null;
}
