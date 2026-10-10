import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { analytics } from '../../analytics';
import { discoveryApi } from '../../api/discovery';
import { safetyApi } from '../../api/safety';
import { useToast, appAlert } from '../../components';
import { useAction } from '../../hooks/useAction';

/** Report / block / unmatch, shared by the profile, chat and date screens so safety is always one tap away. */
export function useSafetyActions(target: { userId: string; name: string | null; matchId?: string | null }, after?: { onBlocked?: () => void; onUnmatched?: () => void }) {
  const { t } = useTranslation();
  const router = useRouter();
  const toast = useToast();
  const name = target.name ?? t('discover.someone');

  const block = useAction(async () => {
    await safetyApi.block({ userId: target.userId });
    analytics.track('block_created', { surface: 'profile' });
    toast.show(t('safety.blocked', { name }), 'success');
    after?.onBlocked?.();
  });

  const unmatch = useAction(async () => {
    if (!target.matchId) return;
    await discoveryApi.unmatch(target.matchId);
    analytics.track('unmatched', {});
    toast.show(t('matches.unmatched', { name }), 'success');
    after?.onUnmatched?.();
  });

  return {
    error: block.error ?? unmatch.error,
    pending: block.pending || unmatch.pending,
    report: (extra: { targetType?: 'user' | 'message' | 'date'; targetId?: string } = {}) =>
      router.push({ pathname: '/safety/report', params: { userId: target.userId, name, targetType: extra.targetType ?? 'user', targetId: extra.targetId ?? target.userId } }),
    confirmBlock: () =>
      appAlert(t('safety.blockTitle', { name }), t('safety.blockBody'), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('safety.block'), style: 'destructive', onPress: () => void block.run() },
      ]),
    confirmUnmatch: () =>
      appAlert(t('matches.unmatchTitle', { name }), t('matches.unmatchBody'), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('matches.unmatch'), style: 'destructive', onPress: () => void unmatch.run() },
      ]),
  };
}
