import { Redirect, Stack } from 'expo-router';
import { homeRouteFor, useSession } from '../../src/auth/SessionProvider';
import { wasVerificationPrompted } from '../../src/screens/auth/VerifyContactScreen';
import { useTheme } from '../../src/theme/ThemeProvider';

/** Signed-out flows. A successful sign-in anywhere in here re-renders this layout and redirects onward. */
export default function AuthLayout() {
  const { state } = useSession();
  const { colors } = useTheme();
  if (state.status === 'signedIn') return <Redirect href={homeRouteFor(state.user, { verificationPrompted: wasVerificationPrompted() })} />;
  return (
    <Stack screenOptions={{ headerTitle: '', headerShadowVisible: false, headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.primary }}>
      <Stack.Screen name="welcome" options={{ headerShown: false }} />
    </Stack>
  );
}
