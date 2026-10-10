import { useCallback, useEffect, useRef, useState } from 'react';

export type ResourceStatus = 'loading' | 'error' | 'ready';

export interface Resource<T> {
  status: ResourceStatus;
  data: T | undefined;
  error: unknown;
  reload: () => void;
  /** Replace the cached value (e.g. with a mutation's response) without refetching. */
  setData: (next: T) => void;
}

/**
 * Minimal async loader with explicit loading/error/ready states. Stale responses (deps changed or unmounted) are
 * discarded so a slow request can never overwrite newer data.
 */
export function useResource<T>(load: () => Promise<T>, deps: readonly unknown[] = [], enabled = true): Resource<T> {
  const [state, setState] = useState<{ status: ResourceStatus; data?: T; error?: unknown }>({ status: 'loading' });
  const [nonce, setNonce] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    setState((s) => ({ status: 'loading', data: s.data }));
    loadRef.current().then(
      (data) => live && setState({ status: 'ready', data }),
      (error: unknown) => live && setState((s) => ({ status: 'error', error, data: s.data })),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce, enabled]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const setData = useCallback((data: T) => setState({ status: 'ready', data }), []);
  return { status: state.status, data: state.data, error: state.error, reload, setData };
}
