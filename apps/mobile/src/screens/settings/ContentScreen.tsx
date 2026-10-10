import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { contentApi, CONTENT_KINDS, type ContentKind } from '../../api';
import { useSession } from '../../auth/SessionProvider';
import { Markdown, Screen, Text } from '../../components';
import { useResource } from '../../hooks/useResource';
import { useTheme } from '../../theme/ThemeProvider';
import { MIN_TOUCH } from '../../theme/tokens';

/** FAQ / help / safety tips from the CMS (localized and country-targeted by the API). */
export default function ContentScreen() {
  const { t, i18n } = useTranslation();
  const { spacing, colors } = useTheme();
  const { user } = useSession();
  const { kind: raw } = useLocalSearchParams<{ kind: string }>();
  const kind = (CONTENT_KINDS as readonly string[]).includes(raw ?? '') ? (raw as ContentKind) : 'faq';
  const entries = useResource(() => contentApi.list(kind, user?.countryCode ?? undefined), [kind, i18n.language, user?.countryCode]);
  const [open, setOpen] = useState<string | null>(null);

  return (
    <Screen
      title={t(`content.kinds.${kind}`)}
      status={entries.status === 'ready' && entries.data?.length === 0 ? 'empty' : entries.status}
      error={entries.error}
      onRetry={entries.reload}
      emptyTitle={t('content.empty')}
      testID="content-screen"
    >
      {entries.data?.map((e) => {
        const expanded = open === e.id;
        return (
          <View key={e.id} style={{ borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: spacing.sm }}>
            <Pressable
              testID={`content-${e.key}`}
              onPress={() => setOpen(expanded ? null : e.id)}
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              accessibilityLabel={e.title}
              style={{ minHeight: MIN_TOUCH, justifyContent: 'center' }}
            >
              <Text variant="label">{e.title}</Text>
            </Pressable>
            {expanded ? <Markdown source={e.bodyMarkdown} testID={`content-body-${e.key}`} /> : null}
          </View>
        );
      })}
    </Screen>
  );
}
