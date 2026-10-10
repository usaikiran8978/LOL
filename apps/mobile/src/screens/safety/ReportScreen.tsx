import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { analytics } from '../../analytics';
import { isApiError } from '../../api';
import { safetyApi } from '../../api/safety';
import { Button, Checkbox, FormError, Notice, Screen, Select, TextField } from '../../components';
import { useAction } from '../../hooks/useAction';
import { useResource } from '../../hooks/useResource';

type Target = 'user' | 'profile' | 'media' | 'message' | 'prompt' | 'event' | 'date';

/** Report a person, message, or date. Reasons come from the server catalog (admin-managed, localized). */
export default function ReportScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const p = useLocalSearchParams<{ userId: string; name?: string; targetType?: Target; targetId?: string }>();
  const targetType: Target = p.targetType ?? 'user';
  const targetId = p.targetId ?? p.userId;
  const reasons = useResource(() => safetyApi.reportReasons(i18n.language), [i18n.language]);
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState('');
  const [alsoBlock, setAlsoBlock] = useState(targetType !== 'date');
  const [done, setDone] = useState<'reported' | 'already' | null>(null);

  const submit = useAction(async () => {
    if (!reason || !targetId) return;
    try {
      const r = await safetyApi.report({ targetType, targetId, reasonKey: reason, details: details.trim() || undefined, alsoBlock, messageIds: targetType === 'message' ? [targetId] : [] });
      analytics.track('report_submitted', { targetType, reason });
      if (r.blocked) analytics.track('block_created', { surface: 'report' });
      setDone('reported');
    } catch (e) {
      if (isApiError(e, 'ALREADY_REPORTED')) return setDone('already');
      throw e;
    }
  });

  if (done) {
    return (
      <Screen title={t('report.title')} testID="report-screen">
        <Notice tone={done === 'reported' ? 'success' : 'info'} title={t(done === 'reported' ? 'report.thanks' : 'errors.ALREADY_REPORTED')} body={t('report.next')} testID="report-done" />
        <Button label={t('common.done')} onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen
      title={t('report.title')}
      subtitle={p.name ? t(`report.subtitle.${targetType === 'message' ? 'message' : targetType === 'date' ? 'date' : 'user'}`, { name: p.name }) : undefined}
      status={reasons.data ? 'ready' : reasons.status}
      error={reasons.error}
      onRetry={reasons.reload}
      testID="report-screen"
    >
      <Select testID="report-reason" label={t('report.reason')} value={reason} options={(reasons.data ?? []).map((r) => ({ value: r.key, label: r.label, description: r.description ?? undefined }))} onChange={setReason} />
      <TextField testID="report-details" label={t('report.details')} hint={t('report.detailsHint')} multiline maxLength={2000} value={details} onChangeText={setDetails} />
      {p.userId ? <Checkbox testID="report-block" label={t('report.alsoBlock', { name: p.name ?? t('discover.someone') })} checked={alsoBlock} onChange={setAlsoBlock} /> : null}
      <FormError error={submit.error} />
      <View>
        <Button testID="report-submit" label={t('report.submit')} disabled={!reason} loading={submit.pending} onPress={() => void submit.run()} />
      </View>
    </Screen>
  );
}
