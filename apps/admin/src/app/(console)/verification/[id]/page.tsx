'use client';

import '@/features/safety/styles.css';
import { useParams } from 'next/navigation';
import { VerificationDetailPage } from '@/features/safety/VerificationDetailPage';

export default function Page() {
  const { id } = useParams<{ id: string }>();
  return <VerificationDetailPage requestId={id} />;
}
