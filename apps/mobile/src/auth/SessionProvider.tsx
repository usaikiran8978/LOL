import type { ErrorCode } from '@amora/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { analytics } from '../analytics';
import { authApi, client, isApiError, onSessionExpired, usersApi, type AuthResult, type MeResponse } from '../api';

export type SessionState =
  | { status: 'restoring' }
  | { status: 'unreachable'; error: unknown }
  | { status: 'signedOut'; reason?: ErrorCode }
  | { status: 'signedIn'; user: MeResponse };

interface SessionContextValue {
  state: SessionState;
  user: MeResponse | null;
  signIn: (result: AuthResult) => Promise<void>;
  signOut: () => Promise<void>;
  setUser: (user: MeResponse) => void;
  refreshUser: () => Promise<MeResponse | null>;
  retryRestore: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession outside SessionProvider');
  return ctx;
}

/** Where a signed-in user belongs right now. */
export function homeRouteFor(user: MeResponse, opts: { verificationPrompted?: boolean } = {}): '/verify' | '/onboarding' | '/home' {
  if (!user.emailVerified && !user.phoneVerified && !opts.verificationPrompted) return '/verify';
  if (!user.onboardingCompleted) return '/onboarding';
  return '/home';
}

/** A previously withdrawn analytics consent must be applied before queued events are sent. */
async function applyAnalyticsConsent(): Promise<void> {
  const consents = await usersApi.consents().catch(() => null);
  if (consents) analytics.setConsent(consents.find((x) => x.consentType === 'analytics')?.granted ?? true);
  analytics.setAuthenticated(true);
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: 'restoring' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    onSessionExpired((code) => {
      analytics.setAuthenticated(false);
      setState({ status: 'signedOut', reason: code });
    });
    return () => onSessionExpired(undefined);
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        if (!(await client.hasSession())) return live && setState({ status: 'signedOut' });
        const user = await usersApi.me();
        if (!live) return;
        setState({ status: 'signedIn', user });
        await applyAnalyticsConsent();
      } catch (e) {
        if (!live) return;
        // No network: keep the stored session and let the user retry. Auth failures already cleared it.
        if (isApiError(e) && e.status === 0) setState({ status: 'unreachable', error: e });
        else setState({ status: 'signedOut' });
      }
    })();
    return () => {
      live = false;
    };
  }, [attempt]);

  const signIn = useCallback(async (result: AuthResult) => {
    await client.setSession(result.tokens);
    setState({ status: 'signedIn', user: result.user });
    await applyAnalyticsConsent();
  }, []);

  const signOut = useCallback(async () => {
    await analytics.flush().catch(() => undefined);
    // Server revocation is best-effort; local credentials are always discarded.
    await authApi.logout().catch(() => undefined);
    analytics.setAuthenticated(false);
    await client.clearSession();
    setState({ status: 'signedOut' });
  }, []);

  const setUser = useCallback((user: MeResponse) => setState({ status: 'signedIn', user }), []);

  const refreshUser = useCallback(async () => {
    try {
      const user = await usersApi.me();
      setState({ status: 'signedIn', user });
      return user;
    } catch {
      return null;
    }
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({
      state,
      user: state.status === 'signedIn' ? state.user : null,
      signIn,
      signOut,
      setUser,
      refreshUser,
      retryRestore: () => {
        setState({ status: 'restoring' });
        setAttempt((n) => n + 1);
      },
    }),
    [state, signIn, signOut, setUser, refreshUser],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
