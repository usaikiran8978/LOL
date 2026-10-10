import { Suspense } from 'react';
import { UserBillingPage } from '@/features/billing/UserBillingPage';

export default function Page() {
  // useSearchParams (userId) requires a Suspense boundary for static prerendering.
  return (
    <Suspense>
      <UserBillingPage />
    </Suspense>
  );
}
