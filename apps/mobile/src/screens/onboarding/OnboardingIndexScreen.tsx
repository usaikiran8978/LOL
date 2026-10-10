import { Redirect } from 'expo-router';
import { useEffect } from 'react';
import { useSession } from '../../auth/SessionProvider';
import { Screen } from '../../components';
import { resumeStep } from '../../onboarding/navigation';
import { useOnboarding } from '../../onboarding/OnboardingContext';

/** Resume point: sends the user to the server's current step (save & resume across devices/launches). */
export default function OnboardingIndexScreen() {
  const { resource, skipped } = useOnboarding();
  const { user, refreshUser } = useSession();
  const done = !!resource.data?.completedAt;
  useEffect(() => {
    if (done && user && !user.onboardingCompleted) void refreshUser();
  }, [done, user, refreshUser]);

  if (!resource.data) return <Screen status={resource.status === 'error' ? 'error' : 'loading'} error={resource.error} onRetry={resource.reload} testID="onboarding-index" />;
  if (done) return <Redirect href="/home" />;
  const step = resumeStep(resource.data, skipped);
  return <Redirect href={step ? `/onboarding/${step}` : '/onboarding/complete'} />;
}
