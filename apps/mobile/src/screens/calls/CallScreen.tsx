import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { analytics } from '../../analytics';
import { callsApi, type CallJoin } from '../../api/chat';
import { Button, FormError, Notice, Screen, Text } from '../../components';
import { useAction } from '../../hooks/useAction';
import { useRealtimeEvent } from '../../realtime/RealtimeProvider';
import { useTheme } from '../../theme/ThemeProvider';

/**
 * Voice/video call entry. Everything up to joining is real: the API creates the call and returns a LiveKit URL +
 * token. The LiveKit native SDK (WebRTC) is not part of this Expo build, so instead of a fake call UI the screen
 * states that calls need the native build, and ends the call cleanly.
 */
export default function CallScreen() {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const router = useRouter();
  const { conversationId, kind: kindParam, name, callId: incomingId, mode } = useLocalSearchParams<{ conversationId?: string; kind?: string; name?: string; callId?: string; mode?: 'accept' }>();
  const kind = kindParam === 'video' ? 'video' : 'voice';
  const [join, setJoin] = useState<CallJoin | null>(null);
  const [ended, setEnded] = useState<'ended' | 'declined' | 'missed' | null>(null);
  const joinRef = useRef<CallJoin | null>(null);

  const start = useAction(async () => {
    const r = mode === 'accept' && incomingId ? await callsApi.accept(incomingId) : await callsApi.start(conversationId!, kind);
    joinRef.current = r;
    setJoin(r);
    analytics.track('call_started', { kind, direction: mode === 'accept' ? 'incoming' : 'outgoing' });
  });

  const end = useAction(async () => {
    const id = joinRef.current?.callId;
    joinRef.current = null;
    if (id) await callsApi.end(id);
    router.back();
  });

  useEffect(() => {
    void start.run();
    // Leaving the screen ends the call so the other person is not left ringing.
    return () => {
      const id = joinRef.current?.callId;
      if (id) void callsApi.end(id).catch(() => undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useRealtimeEvent('notification', (d) => {
    const e = d as { type?: string; callId?: string };
    if (!e?.type?.startsWith('call.') || e.callId !== joinRef.current?.callId) return;
    if (e.type === 'call.ended' || e.type === 'call.declined' || e.type === 'call.missed') {
      joinRef.current = null;
      setEnded(e.type === 'call.ended' ? 'ended' : e.type === 'call.declined' ? 'declined' : 'missed');
    }
  });

  const title = t(kind === 'video' ? 'calls.videoWith' : 'calls.voiceWith', { name: name || t('discover.someone') });

  return (
    <Screen title={title} status={start.pending && !join ? 'loading' : 'ready'} testID="call-screen">
      {ended ? (
        <View testID="call-ended">
          <Notice title={t(`calls.status.${ended}`)} />
          <Button label={t('common.close')} onPress={() => router.back()} />
        </View>
      ) : join ? (
        <View testID="call-native-required">
          <Notice tone="warning" title={t('calls.nativeRequiredTitle')} body={t('calls.nativeRequiredBody')} />
          <Text variant="caption" color="textMuted" style={{ marginBottom: spacing.lg }}>
            {t('calls.ready')}
          </Text>
          <Button variant="danger" label={t('calls.end')} onPress={() => void end.run()} loading={end.pending} testID="call-end" />
          <FormError error={end.error} />
        </View>
      ) : start.error ? (
        <View testID="call-error">
          <FormError error={start.error} />
          <Button variant="secondary" label={t('common.retry')} onPress={() => void start.run()} testID="call-retry" />
          <Button variant="ghost" label={t('common.close')} onPress={() => router.back()} style={{ marginTop: spacing.sm }} />
        </View>
      ) : null}
    </Screen>
  );
}
