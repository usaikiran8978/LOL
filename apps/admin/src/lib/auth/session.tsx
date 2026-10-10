'use client';

import type { Permission } from '@amora/shared';
import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { adminApi, type AdminApi, type AdminIdentity } from '../api/admin-api';
import { ApiError, ReauthCancelledError, createApiClient } from '../api/client';
import { ReauthDialog } from '@/components/auth/ReauthDialog';

export type SessionStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'error';

export interface LoginInput {
  email: string;
  password: string;
  totp?: string;
}

interface SessionContextValue {
  status: SessionStatus;
  /** Why the initial session check failed (status 'error'), e.g. API unreachable. */
  error: unknown;
  admin: AdminIdentity | null;
  /** False after a reload: the cookie survives but the in-memory CSRF token does not. */
  hasCsrf: boolean;
  api: AdminApi;
  login(input: LoginInput): Promise<void>;
  logout(): Promise<void>;
  reload(): void;
  can(permission: Permission): boolean;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function safeReturnTo(value: string | null | undefined): string {
  // Only same-origin absolute paths; rejects `//evil.com`, `/\evil.com` and scheme URLs (open-redirect guard).
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\') || value.startsWith('/login')) return '/';
  return value;
}

export function loginUrl(returnTo: string, reason?: 'expired'): string {
  const qs = new URLSearchParams();
  if (returnTo && returnTo !== '/') qs.set('returnTo', returnTo);
  if (reason) qs.set('reason', reason);
  const s = qs.toString();
  return `/login${s ? `?${s}` : ''}`;
}

interface PendingReauth {
  promise: Promise<string>;
  resolve: (token: string) => void;
  reject: (err: unknown) => void;
}

export function SessionProvider({ children, fetchImpl }: { children: ReactNode; fetchImpl?: typeof fetch }) {
  const router = useRouter();
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [admin, setAdmin] = useState<AdminIdentity | null>(null);
  // Held only in memory (never Web Storage) so it cannot be harvested from storage; a reload loses it by design.
  const csrfRef = useRef<string | null>(null);
  const [hasCsrf, setHasCsrf] = useState(false);
  const [reauthOpen, setReauthOpen] = useState(false);
  const pendingReauth = useRef<PendingReauth | null>(null);
  const [loadNonce, setLoadNonce] = useState(0);
  const [loadError, setLoadError] = useState<unknown>(null);

  const setCsrf = useCallback((token: string | null) => {
    csrfRef.current = token;
    setHasCsrf(!!token);
  }, []);

  const api = useMemo(
    () =>
      adminApi(
        createApiClient({
          fetchImpl,
          getCsrfToken: () => csrfRef.current,
          reauthenticate: () => {
            if (pendingReauth.current) return pendingReauth.current.promise;
            let resolve!: (token: string) => void;
            let reject!: (err: unknown) => void;
            const promise = new Promise<string>((res, rej) => {
              resolve = res;
              reject = rej;
            });
            pendingReauth.current = { promise, resolve, reject };
            setReauthOpen(true);
            return promise;
          },
          onUnauthenticated: () => {
            setCsrf(null);
            setAdmin(null);
            setStatus('unauthenticated');
            const here = typeof window === 'undefined' ? '/' : `${window.location.pathname}${window.location.search}`;
            router.replace(loginUrl(safeReturnTo(here), 'expired'));
          },
        }),
      ),
    [fetchImpl, router, setCsrf],
  );

  useEffect(() => {
    let cancelled = false;
    api.auth
      .me()
      .then((me) => {
        if (cancelled) return;
        setAdmin(me);
        setStatus('authenticated');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setAdmin(null);
        setLoadError(err);
        setStatus(err instanceof ApiError && err.status === 401 ? 'unauthenticated' : 'error');
      });
    return () => {
      cancelled = true;
    };
  }, [api, loadNonce]);

  const login = useCallback(
    async (input: LoginInput) => {
      const res = await api.auth.login(input);
      setCsrf(res.csrfToken);
      const me = await api.auth.me();
      setAdmin({ ...me, displayName: res.admin.displayName });
      setStatus('authenticated');
    },
    [api, setCsrf],
  );

  const logout = useCallback(async () => {
    try {
      // Without an in-memory token this goes through re-authentication first: the API requires CSRF on
      // logout, and the httpOnly cookie cannot be cleared from script, so skipping the call would leave
      // the browser signed in.
      await api.auth.logout();
    } catch (e) {
      if (e instanceof ReauthCancelledError) throw e;
      // Any other failure: the session is being abandoned either way and expires server-side.
    }
    setCsrf(null);
    setAdmin(null);
    setStatus('unauthenticated');
  }, [api, setCsrf]);

  const finishReauth = useCallback(
    async (input: LoginInput) => {
      await login(input);
      const pending = pendingReauth.current;
      pendingReauth.current = null;
      setReauthOpen(false);
      pending?.resolve(csrfRef.current!);
    },
    [login],
  );

  const cancelReauth = useCallback(() => {
    const pending = pendingReauth.current;
    pendingReauth.current = null;
    setReauthOpen(false);
    pending?.reject(new ReauthCancelledError());
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({
      status,
      error: loadError,
      admin,
      hasCsrf,
      api,
      login,
      logout,
      reload: () => {
        setStatus('loading');
        setLoadNonce((n) => n + 1);
      },
      can: (p) => !!admin?.permissions.includes(p),
    }),
    [status, loadError, admin, hasCsrf, api, login, logout],
  );

  return (
    <SessionContext.Provider value={value}>
      {children}
      {reauthOpen ? <ReauthDialog email={admin?.email ?? ''} onSubmit={finishReauth} onCancel={cancelReauth} /> : null}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}

export function useAdminApi(): AdminApi {
  return useSession().api;
}
