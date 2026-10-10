import * as WebBrowser from 'expo-web-browser';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { analytics } from '../../analytics';
import { ApiError } from '../../api/errors';
import { privacyRequestsApi, type PrivacyRequest } from '../../api/privacyRequests';
import { useSession } from '../../auth/SessionProvider';
import { Badge, Button, FormError, ListItem, Notice, Screen, Text, useToast } from '../../components';
import { useAction } from '../../hooks/useAction';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';
import { useResource } from '../../hooks/useResource';
import { formatDate, formatDateTime } from '../../i18n/format';
import { useTheme } from '../../theme/ThemeProvider';

const OPEN = new Set(['received', 'verifying', 'in_progress']);

/** Download my data (export request + status + link) and account deletion status / restore. */
export default function DataPrivacyScreen() {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const { refreshUser } = useSession();
  const requests = useResource(privacyRequestsApi.list);
  useRefreshOnFocus(requests.reload);
  const list = requests.data ?? [];
  const exports = list.filter((r) => r.kind === 'export');
  const pendingExport = exports.find((r) => OPEN.has(r.status));
  const deletion = list.find((r) => r.kind === 'delete' && r.status === 'in_progress' && r.scheduledFor);

  const requestExport = useAction(async () => {
    try {
      await privacyRequestsApi.requestExport();
      analytics.track('data_export_requested', {});
      toast.show(t('dataPrivacy.exportRequested'), 'success');
    } catch (e) {
      // One open export at a time: the existing one is shown below.
      if (!(e instanceof ApiError && e.code === 'CONFLICT')) throw e;
    }
    requests.reload();
  });
  const restore = useAction(async () => {
    await privacyRequestsApi.cancelDeletion();
    await refreshUser();
    toast.show(t('dataPrivacy.restored'), 'success');
    requests.reload();
  });

  const exportRow = (r: PrivacyRequest) => (
    <View key={r.id} testID={`export-${r.id}`} style={{ marginBottom: spacing.md }}>
      <ListItem label={t('dataPrivacy.exportFrom', { date: formatDateTime(r.requestedAt) })} value={t(`dataPrivacy.status.${r.status}`)} />
      {r.downloadUrl ? <Button variant="secondary" label={t('dataPrivacy.download')} onPress={() => void WebBrowser.openBrowserAsync(r.downloadUrl!)} testID={`export-download-${r.id}`} /> : null}
    </View>
  );

  return (
    <Screen title={t('dataPrivacy.title')} status={requests.data ? 'ready' : requests.status} error={requests.error} onRetry={requests.reload} testID="data-privacy-screen">
      {deletion ? (
        <View testID="deletion-pending">
          <Notice tone="danger" title={t('dataPrivacy.deletionScheduled', { date: formatDate(deletion.scheduledFor) })} body={t('dataPrivacy.restoreHint')} />
          <FormError error={restore.error} />
          <Button label={t('dataPrivacy.restore')} onPress={() => void restore.run()} loading={restore.pending} testID="deletion-restore" />
        </View>
      ) : null}

      <Text variant="heading" style={{ marginTop: spacing.lg, marginBottom: spacing.xs }}>
        {t('settings.exportData')}
      </Text>
      <Text color="textMuted" style={{ marginBottom: spacing.md }}>
        {t('dataPrivacy.exportIntro')}
      </Text>
      <FormError error={requestExport.error} />
      {pendingExport ? <Badge tone="warning" label={t('dataPrivacy.exportInProgress')} testID="export-pending" /> : <Button label={t('dataPrivacy.requestExport')} onPress={() => void requestExport.run()} loading={requestExport.pending} testID="export-request" />}
      <View style={{ marginTop: spacing.md }}>{exports.length ? exports.map(exportRow) : <Text color="textMuted">{t('dataPrivacy.noExports')}</Text>}</View>

      {!deletion ? (
        <View style={{ marginTop: spacing.xl }}>
          <ListItem testID="open-delete-account" label={t('settings.deleteAccount')} destructive onPress={() => router.push('/settings/delete-account')} />
        </View>
      ) : null}
    </Screen>
  );
}
