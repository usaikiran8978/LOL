import { Suspense } from 'react';
import { PricesPage } from '@/features/billing/PricesPage';

export default function Page() {
  // useSearchParams (selected product) requires a Suspense boundary for static prerendering.
  return (
    <Suspense>
      <PricesPage />
    </Suspense>
  );
}
