import { Suspense } from 'react';
import { LoginScreen } from '@/features/auth/LoginScreen';

export default function LoginPage() {
  // useSearchParams (returnTo) requires a Suspense boundary for static prerendering.
  return (
    <Suspense>
      <LoginScreen />
    </Suspense>
  );
}
