import { MatchingGate } from '@/features/matching/MatchingGate';
import { ConfigVersionsPage } from '@/features/matching/ConfigVersionsPage';

export default function Page() {
  return <MatchingGate index><ConfigVersionsPage /></MatchingGate>;
}
