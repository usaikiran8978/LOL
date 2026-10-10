import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { client } from '../api';
import { RealtimeClient, type RealtimeHandler, type RealtimeStatus } from './RealtimeClient';

interface RealtimeContextValue {
  status: RealtimeStatus;
  subscribe: (event: string, handler: RealtimeHandler) => () => void;
  send: RealtimeClient['send'];
}

/** Default (no provider, e.g. tests): never connected, so screens use their polling fallback. */
const RealtimeContext = createContext<RealtimeContextValue>({ status: 'idle', subscribe: () => () => undefined, send: () => false });

export function RealtimeProvider({ children, enabled }: { children: ReactNode; enabled: boolean }) {
  const ref = useRef<RealtimeClient | null>(null);
  const [status, setStatus] = useState<RealtimeStatus>('idle');

  useEffect(() => {
    if (!enabled) return;
    const rt = new RealtimeClient({
      url: client.websocketUrl,
      getToken: () => client.freshAccessToken(),
      refreshToken: (used) => client.accessTokenAfterRejection(used),
    });
    ref.current = rt;
    const offStatus = rt.onStatus(setStatus);
    rt.start();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && rt.wake());
    return () => {
      sub.remove();
      offStatus();
      rt.stop();
      ref.current = null;
      setStatus('idle');
    };
  }, [enabled]);

  const value = useMemo<RealtimeContextValue>(
    () => ({
      status,
      subscribe: (event, handler) => ref.current?.on(event, handler) ?? (() => undefined),
      send: (frame) => ref.current?.send(frame) ?? false,
    }),
    [status],
  );
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export const useRealtime = () => useContext(RealtimeContext);

/** Subscribe to a realtime event for the lifetime of the component (re-subscribes when the connection changes). */
export function useRealtimeEvent(event: string, handler: RealtimeHandler): void {
  const { subscribe, status } = useRealtime();
  const h = useRef(handler);
  h.current = handler;
  useEffect(() => subscribe(event, (d) => h.current(d)), [subscribe, event, status]);
}
