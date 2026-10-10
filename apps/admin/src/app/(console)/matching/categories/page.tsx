import { MatchingGate } from '@/features/matching/MatchingGate';
import { CategoriesPage } from '@/features/matching/CategoriesPage';

export default function Page() {
  return <MatchingGate><CategoriesPage /></MatchingGate>;
}
