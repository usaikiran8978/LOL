'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { RequirePermission } from '@/components/shell/RouteGuard';
import { LoadingState } from '@/components/ui/states';
import { useSession } from '@/lib/auth/session';

/**
 * The /matching nav entry is also open to admins who only hold matching.test; every page except the test
 * tool needs matching.view. Test-only admins opening the module index are sent to the test tool.
 */
export function MatchingGate({ children, index = false }: { children: ReactNode; index?: boolean }) {
  const { admin } = useSession();
  const router = useRouter();
  const perms = admin?.permissions ?? [];
  const testOnly = index && !perms.includes('matching.view') && perms.includes('matching.test');
  useEffect(() => {
    if (testOnly) router.replace('/matching/test');
  }, [testOnly, router]);
  if (testOnly) return <LoadingState />;
  return <RequirePermission permission="matching.view" permissions={perms}>{children}</RequirePermission>;
}
