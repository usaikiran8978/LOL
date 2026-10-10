import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { callsApi } from '../../api/chat';
import { useSession } from '../../auth/SessionProvider';
import { useRealtimeEvent } from '../../realtime/RealtimeProvider';
import { appAlert } from '../../components';

/** Call signalling arrives as realtime `notification` frames ({type:'call.incoming', callId, conversationId, kind, from}). */
export function IncomingCallListener() {
  const { t } = useTranslation();
  const router = useRouter();
  const { user } = useSession();
  useRealtimeEvent('notification', (d) => {
    const e = d as { type?: string; callId?: string; conversationId?: string; kind?: string; from?: string };
    if (e?.type !== 'call.incoming' || !e.callId || e.from === user?.id) return;
    const kind = e.kind === 'video' ? 'video' : 'voice';
    appAlert(t(kind === 'video' ? 'calls.incomingVideo' : 'calls.incomingVoice'), t('calls.incomingBody'), [
      { text: t('calls.decline'), style: 'cancel', onPress: () => void callsApi.decline(e.callId!).catch(() => undefined) },
      { text: t('calls.accept'), onPress: () => router.push({ pathname: '/call', params: { callId: e.callId!, mode: 'accept', kind, conversationId: e.conversationId ?? '' } }) },
    ]);
  });
  return null;
}
