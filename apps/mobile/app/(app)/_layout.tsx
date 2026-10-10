import { Redirect, Stack } from 'expo-router';
import { useEffect } from 'react';
import { useSession } from '../../src/auth/SessionProvider';
import { Screen } from '../../src/components';
import { IncomingCallListener } from '../../src/features/calls/IncomingCallListener';
import { registerForPush } from '../../src/notifications/push';
import { RealtimeProvider } from '../../src/realtime/RealtimeProvider';
import { useTheme } from '../../src/theme/ThemeProvider';

/** Signed-in area guard. Also owns the realtime connection and refreshes the push token registration. */
export default function AppLayout() {
  const { state } = useSession();
  const { colors } = useTheme();
  const signedIn = state.status === 'signedIn';
  const userId = signedIn ? state.user.id : null;

  // Tokens rotate; re-register on every sign-in when permission was already granted (never prompts here).
  useEffect(() => {
    if (userId) void registerForPush({ prompt: false }).catch(() => undefined);
  }, [userId]);

  if (state.status === 'restoring') return <Screen status="loading" />;
  if (!signedIn) return <Redirect href="/welcome" />;
  return (
    <RealtimeProvider enabled={signedIn}>
      <IncomingCallListener />
      <Stack screenOptions={{ headerTitle: '', headerShadowVisible: false, headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.primary }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
      </Stack>
    </RealtimeProvider>
  );
}
