'use client';

import { useParams } from 'next/navigation';
import { VersionPage } from '@/features/questionnaire/VersionPage';

export default function Page() {
  const { id, versionId } = useParams<{ id: string; versionId: string }>();
  return <VersionPage key={versionId} questionId={id} versionId={versionId} />;
}
