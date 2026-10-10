import { Stack } from 'expo-router';
import { OnboardingProvider } from '../../../src/onboarding/OnboardingContext';
import { useTheme } from '../../../src/theme/ThemeProvider';

export default function OnboardingLayout() {
  const { colors } = useTheme();
  return (
    <OnboardingProvider>
      {/* Steps replace each other; Back/Skip are explicit in-page actions driven by the flow definition. */}
      <Stack screenOptions={{ headerShown: false, animation: 'fade', contentStyle: { backgroundColor: colors.background } }} />
    </OnboardingProvider>
  );
}
