import { ExperimentDetailPage } from '@/features/analytics/ExperimentDetailPage';

export default async function Page({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return <ExperimentDetailPage experimentKey={key} />;
}
