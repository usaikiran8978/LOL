'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { t } from '@/i18n';
import { loginUrl, safeReturnTo, useSession } from '@/lib/auth/session';
import { Button } from '../ui/Button';
import { ErrorState, LoadingState } from '../ui/states';
import { NoticeProvider } from './notice';
import { RouteGuard } from './RouteGuard';
import { Sidebar } from './Sidebar';

const ACCOUNT_PATH = '/account';

export function ConsoleShell({ children }: { children: ReactNode }) {
  const session = useSession();
  const router = useRouter();
  const pathname = usePathname() ?? '/';
  const mainRef = useRef<HTMLElement>(null);
  const [signingOut, setSigningOut] = useState(false);
  const firstRender = useRef(true);

  useEffect(() => {
    if (session.status === 'unauthenticated' && !signingOut) {
      const here = `${window.location.pathname}${window.location.search}`;
      router.replace(loginUrl(safeReturnTo(here)));
    }
  }, [session.status, router, signingOut]);

  // Deployments that require MFA reject every other admin call until it is set up: send the admin to set it up.
  const mfaSetupRequired = session.status === 'authenticated' && !!session.admin?.mfaSetupRequired;
  useEffect(() => {
    if (mfaSetupRequired && pathname !== ACCOUNT_PATH) router.replace(ACCOUNT_PATH);
  }, [mfaSetupRequired, pathname, router]);

  // Move focus to the main region on client-side navigation so screen readers announce the new page.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    mainRef.current?.focus();
  }, [pathname]);

  if (session.status === 'loading' || session.status === 'unauthenticated') return <LoadingState />;
  if (session.status === 'error') {
    return (
      <main className="centered">
        <ErrorState error={session.error} onRetry={session.reload} />
      </main>
    );
  }
  const admin = session.admin!;

  async function signOut() {
    setSigningOut(true);
    try {
      await session.logout();
      router.replace('/login?reason=signedout');
    } catch {
      // Re-authentication was cancelled: stay signed in.
      setSigningOut(false);
    }
  }

  return (
    <NoticeProvider>
      <a href="#main" className="skip-link">{t('app.skipToContent')}</a>
      <div className="shell">
        <header className="topbar">
          <span className="topbar__brand">{t('app.name')}<span className="topbar__tagline">{t('app.tagline')}</span></span>
          <span className="topbar__user">{t('auth.signedInAs', { email: admin.displayName || admin.email })}</span>
          <Link href={ACCOUNT_PATH} className="btn btn--ghost btn--sm" aria-current={pathname === ACCOUNT_PATH ? 'page' : undefined}>{t('admins.account.title')}</Link>
          <Button variant="ghost" size="sm" onClick={() => void signOut()} disabled={signingOut}>
            {signingOut ? t('auth.signingOut') : t('auth.signOut')}
          </Button>
        </header>
        <Sidebar permissions={admin.permissions} pathname={pathname} />
        <main id="main" ref={mainRef} tabIndex={-1} className="main">
          {!session.hasCsrf ? <p className="alert alert--info">{t('auth.readOnlySession')}</p> : null}
          <RouteGuard pathname={pathname} permissions={admin.permissions}>{children}</RouteGuard>
        </main>
      </div>
    </NoticeProvider>
  );
}
