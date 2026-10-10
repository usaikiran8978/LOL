import '../src/i18n';
import { Anton_400Regular, useFonts } from '@expo-google-fonts/anton';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { analytics } from '../src/analytics';
import { SessionProvider, useSession } from '../src/auth/SessionProvider';
import { AlertHost, ToastProvider, useToast } from '../src/components';
import { ConfigProvider } from '../src/config/ConfigProvider';
import { restoreLanguage } from '../src/i18n';
import { ThemeProvider, useTheme } from '../src/theme/ThemeProvider';

/** Tells the user why they were signed out (expired / revoked elsewhere / reuse detected). */
function SessionNotices() {
  const { t } = useTranslation();
  const { state } = useSession();
  const toast = useToast();
  const reason = state.status === 'signedOut' ? state.reason : undefined;
  useEffect(() => {
    if (reason) toast.show(t(reason === 'REFRESH_TOKEN_REUSED' ? 'session.revokedForSecurity' : 'session.expired'), 'error');
  }, [reason, t, toast]);
  return null;
}

function Navigator() {
  const { colors, scheme } = useTheme();
  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          // Screen titles are rendered in-page (localized, Dynamic Type aware); the native bar only provides Back.
          headerTitle: '',
          headerShadowVisible: false,
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.primary,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(app)" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  // Editorial display face; on failure we still render (Text falls back to the system font).
  const [fontsLoaded, fontError] = useFonts({ Anton_400Regular });
  useEffect(() => {
    void restoreLanguage();
    analytics.start();
    return () => analytics.stop();
  }, []);
  if (!fontsLoaded && !fontError) return null;
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ToastProvider>
          <ConfigProvider>
            <SessionProvider>
              <SessionNotices />
              <Navigator />
              <AlertHost />
            </SessionProvider>
          </ConfigProvider>
        </ToastProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
