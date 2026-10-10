import { act, render, type RenderOptions } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';
import { client } from '../api';
import type { AppConfigResponse, MeResponse } from '../api/types';
import { SessionProvider } from '../auth/SessionProvider';
import { ToastProvider } from '../components/Toast';
import { ConfigProvider } from '../config/ConfigProvider';
import { ThemeProvider } from '../theme/ThemeProvider';
import { tokens } from './fixtures';

export const testConfig = (over: Partial<AppConfigResponse> = {}): AppConfigResponse => ({
  flags: {},
  settings: { max_prompts: 3, support_email: 'support@example.com' },
  locales: [{ code: 'en', nativeName: 'English', rtl: false }, { code: 'ar', nativeName: 'العربية', rtl: true }],
  countries: [{ code: 'GB', currency: 'GBP', measurement: 'metric', defaultLocale: 'en' }],
  ...over,
});

export function Providers({ children, config }: { children: ReactNode; config?: AppConfigResponse }) {
  return (
    <ThemeProvider scheme="light">
      <ToastProvider>
        <ConfigProvider initial={config ?? testConfig()}>
          <SessionProvider>{children}</SessionProvider>
        </ConfigProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}

/** Seeds a live session so SessionProvider restores straight into `signedIn` (GET /users/me must be mocked). */
export async function seedSession(): Promise<void> {
  await client.setSession(tokens());
}

export async function signOutForTest(): Promise<void> {
  await client.clearSession();
}

export function renderWithProviders(ui: ReactElement, opts: { config?: AppConfigResponse } & RenderOptions = {}) {
  return render(ui, { wrapper: ({ children }) => <Providers config={opts.config}>{children}</Providers>, ...opts });
}

export type { MeResponse };

/**
 * Lets pending request promises settle inside act(). Needed when an action is started from a callback that RNTL
 * does not wrap (e.g. an Alert button), otherwise React 19 defers those updates until some later timer fires.
 */
export async function flushAsync(ms = 20): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}
