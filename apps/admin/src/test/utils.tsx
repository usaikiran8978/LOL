import type { Permission } from '@amora/shared';
import { PERMISSIONS } from '@amora/shared';
import { render, screen, waitFor } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { expect, vi } from 'vitest';
import { NoticeProvider } from '@/components/shell/notice';
import { SessionProvider, useSession } from '@/lib/auth/session';

export interface RecordedCall {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Record<string, string>;
  body: unknown;
}

type Handler = (call: RecordedCall) => unknown | Response | Promise<unknown | Response>;

export const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const apiError = (status: number, code: string, details?: unknown) => json(status, { error: { code, message: code, details, requestId: 'req-1' } });

/**
 * fetch double keyed by "METHOD /path" (path relative to /api, without query). Handlers return a body
 * (→ 200 JSON) or a Response. Unmatched requests fail loudly so tests notice unexpected calls.
 */
export function createFetchMock(handlers: Record<string, Handler>) {
  const calls: RecordedCall[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://admin.test');
    const call: RecordedCall = {
      method: init?.method ?? 'GET',
      path: url.pathname.replace(/^\/api/, ''),
      query: url.searchParams,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const handler = handlers[`${call.method} ${call.path}`];
    if (!handler) return apiError(404, 'NOT_FOUND');
    const result = await handler(call);
    return result instanceof Response ? result : json(200, result);
  });
  return { fetchMock: fetchMock as unknown as typeof fetch, calls, mutations: () => calls.filter((c) => c.method !== 'GET') };
}

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

/** Auth endpoints for a signed-in admin; login issues CSRF token "csrf-1". */
export function authHandlers(permissions: Permission[] = ALL_PERMISSIONS): Record<string, Handler> {
  let loggedIn = false;
  return {
    'GET /admin/auth/me': () => (loggedIn ? { id: 'a1', email: 'admin@example.com', permissions, countryScope: null } : apiError(401, 'UNAUTHENTICATED')),
    'POST /admin/auth/login': () => {
      loggedIn = true;
      return { admin: { id: 'a1', email: 'admin@example.com', displayName: 'Ada', mfaEnabled: false, permissions }, csrfToken: 'csrf-1', expiresAt: new Date(Date.now() + 3600_000).toISOString() };
    },
    'POST /admin/auth/logout': () => json(204),
  };
}

function AutoLogin({ children }: { children: ReactNode }) {
  const session = useSession();
  useEffect(() => {
    if (session.status === 'unauthenticated') void session.login({ email: 'admin@example.com', password: 'pw' });
  }, [session]);
  return session.status === 'authenticated' ? <>{children}</> : <p>signing in</p>;
}

/** Renders `ui` inside a real SessionProvider that has logged in (so the CSRF token is held in memory). */
export async function renderSignedIn(ui: ReactNode, handlers: Record<string, Handler>, permissions?: Permission[]) {
  const mock = createFetchMock({ ...authHandlers(permissions), ...handlers });
  const utils = render(
    <SessionProvider fetchImpl={mock.fetchMock}>
      <NoticeProvider>
        <AutoLogin>{ui}</AutoLogin>
      </NoticeProvider>
    </SessionProvider>,
  );
  await waitFor(() => expect(screen.queryByText('signing in')).not.toBeInTheDocument());
  return { ...utils, ...mock };
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Form control by its visible label (labels of required fields carry a trailing "*"). */
export const field = (label: string) => screen.getByLabelText(new RegExp(`^${escape(label)}( \\*)?$`));
