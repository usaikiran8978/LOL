import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { configApi, type AppConfigResponse } from '../api';
import { platformName } from '../auth/device';
import { compareVersions } from '../utils/version';
import { env } from './env';

interface ConfigContextValue {
  config: AppConfigResponse | null;
  status: 'loading' | 'error' | 'ready';
  error: unknown;
  reload: (country?: string | null) => Promise<void>;
}

const ConfigContext = createContext<ConfigContextValue>({ config: null, status: 'loading', error: null, reload: async () => undefined });

/**
 * `/v1/config` bootstrap: evaluated feature flags, public settings, supported locales. Reloaded after sign-in since
 * flag targeting depends on the user (country, segment, percentage rollout).
 */
export function ConfigProvider({ children, initial }: { children: ReactNode; initial?: AppConfigResponse }) {
  const [config, setConfig] = useState<AppConfigResponse | null>(initial ?? null);
  const [status, setStatus] = useState<ConfigContextValue['status']>(initial ? 'ready' : 'loading');
  const [error, setError] = useState<unknown>(null);
  const seq = useRef(0);

  const reload = useCallback(async (country?: string | null) => {
    const mine = ++seq.current;
    setError(null);
    setStatus((s) => (s === 'ready' ? s : 'loading'));
    try {
      const next = await configApi.get({ platform: platformName(), appVersion: env.appVersion, country: country ?? undefined });
      if (mine === seq.current) {
        setConfig(next);
        setStatus('ready');
      }
    } catch (e) {
      if (mine !== seq.current) return;
      setError(e);
      // Keep serving the last good config if we have one; only a cold start without config is an error state.
      setStatus((s) => (s === 'ready' ? s : 'error'));
    }
  }, []);

  useEffect(() => {
    if (!initial) void reload();
  }, [initial, reload]);

  const value = useMemo(() => ({ config, status, error, reload }), [config, status, error, reload]);
  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
}

export const useConfig = () => useContext(ConfigContext);

/** Server-evaluated feature flag. Unknown flags are off: features must be explicitly enabled. */
export function useFlag(key: string, fallback = false): boolean {
  const { config } = useConfig();
  return config?.flags[key] ?? fallback;
}

/** Public system setting (`public.*` on the server, exposed without the prefix). */
export function useSetting<T>(key: string, fallback: T): T {
  const { config } = useConfig();
  const v = config?.settings[key];
  return v === undefined || v === null ? fallback : (v as T);
}

export function useUpdateRequired(): boolean {
  const min = useSetting<string | null>('min_supported_app_version', null);
  return !!min && compareVersions(env.appVersion, min) < 0;
}
