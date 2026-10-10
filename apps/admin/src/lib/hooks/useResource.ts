'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type Resource<T> =
  | { status: 'loading'; data: undefined; error: null; reload: () => void }
  | { status: 'error'; data: undefined; error: unknown; reload: () => void }
  | { status: 'success'; data: T; error: null; reload: () => void };

/**
 * Minimal fetch-state hook (loading → success | error) with manual reload. Stale responses from an earlier
 * dependency set are ignored so fast filter changes cannot render out-of-order data.
 */
export function useResource<T>(loader: () => Promise<T>, deps: readonly unknown[]): Resource<T> {
  const [state, setState] = useState<{ status: 'loading' | 'error' | 'success'; data?: T; error: unknown }>({ status: 'loading', error: null });
  const [nonce, setNonce] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    let current = true;
    setState((s) => ({ status: 'loading', data: s.data, error: null }));
    loaderRef.current().then(
      (data) => { if (current) setState({ status: 'success', data, error: null }); },
      (error: unknown) => { if (current) setState({ status: 'error', error }); },
    );
    return () => { current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  if (state.status === 'success') return { status: 'success', data: state.data as T, error: null, reload };
  if (state.status === 'error') return { status: 'error', data: undefined, error: state.error, reload };
  return { status: 'loading', data: undefined, error: null, reload };
}
