import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { safetyApi } from '../../api/safety';
import { Button, FormError, Screen, Text, appAlert } from '../../components';
import { useAction } from '../../hooks/useAction';
import { useResource } from '../../hooks/useResource';
import { formatDate } from '../../i18n/format';
import { useTheme } from '../../theme/ThemeProvider';

export default function BlockedUsersScreen() {
  const { t } = useTranslation();
  const { spacing, colors } = useTheme();
  const blocks = useResource(safetyApi.blocks);
  const unblock = useAction(async (userId: string) => {
    await safetyApi.unblock(userId);
    blocks.setData((blocks.data ?? []).filter((b) => b.userId !== userId));
  });
  const confirm = (userId: string, name: string) =>
    appAlert(t('blocks.unblockTitle', { name }), t('blocks.unblockBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('blocks.unblock'), style: 'destructive', onPress: () => void unblock.run(userId) },
    ]);
  return (
    <Screen
      title={t('settings.blockedUsers')}
      status={blocks.data ? (blocks.data.length ? 'ready' : 'empty') : blocks.status}
      error={blocks.error}
      onRetry={blocks.reload}
      emptyTitle={t('blocks.emptyTitle')}
      emptyBody={t('blocks.emptyBody')}
      testID="blocks-screen"
    >
      <FormError error={unblock.error} />
      {blocks.data?.map((b) => {
        const name = b.displayName ?? t('blocks.unknown');
        return (
          <View key={b.userId} testID={`block-${b.userId}`} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <View style={{ flex: 1 }}>
              <Text>{name}</Text>
              <Text variant="caption" color="textMuted">
                {t('blocks.since', { date: formatDate(b.blockedAt) })}
              </Text>
            </View>
            <Button variant="ghost" label={t('blocks.unblock')} accessibilityHint={name} onPress={() => confirm(b.userId, name)} testID={`unblock-${b.userId}`} />
          </View>
        );
      })}
    </Screen>
  );
}
