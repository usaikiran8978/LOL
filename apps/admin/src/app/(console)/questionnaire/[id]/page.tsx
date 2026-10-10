'use client';

import { useParams } from 'next/navigation';
import { QuestionDetailPage } from '@/features/questionnaire/QuestionDetailPage';

export default function Page() {
  const { id } = useParams<{ id: string }>();
  return <QuestionDetailPage key={id} questionId={id} />;
}
