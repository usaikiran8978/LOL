'use client';

import { useParams } from 'next/navigation';
import { MatchingGate } from '@/features/matching/MatchingGate';
import { ConfigEditorPage } from '@/features/matching/ConfigEditorPage';

export default function Page() {
  const { id } = useParams<{ id: string }>();
  return <MatchingGate><ConfigEditorPage id={id} /></MatchingGate>;
}
