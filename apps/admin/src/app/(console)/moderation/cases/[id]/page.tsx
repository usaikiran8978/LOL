'use client';

import '@/features/safety/styles.css';
import { useParams } from 'next/navigation';
import { CaseDetailPage } from '@/features/safety/CaseDetailPage';

export default function Page() {
  const { id } = useParams<{ id: string }>();
  return <CaseDetailPage caseId={id} />;
}
