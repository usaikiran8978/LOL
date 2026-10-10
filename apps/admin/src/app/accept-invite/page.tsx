import { Suspense } from 'react';
import { AcceptInviteScreen } from '@/features/admins/AcceptInviteScreen';

export default function AcceptInvitePage() {
  // useSearchParams (token) requires a Suspense boundary for static prerendering.
  return (
    <Suspense>
      <AcceptInviteScreen />
    </Suspense>
  );
}
