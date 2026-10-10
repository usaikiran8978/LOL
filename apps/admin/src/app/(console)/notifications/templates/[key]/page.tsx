import { TemplateDetailPage } from '@/features/notifications/TemplateDetailPage';

export default async function Page({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return <TemplateDetailPage templateKey={decodeURIComponent(key)} />;
}
