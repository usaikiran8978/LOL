import { useCallback, useEffect, useRef, useState } from 'react';

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface Paged<T> {
  status: 'loading' | 'error' | 'ready';
  items: T[];
  error: unknown;
  /** Error from the latest "load more" (the list itself stays visible). */
  moreError: unknown;
  hasMore: boolean;
  loadingMore: boolean;
  reload: () => void;
  loadMore: () => void;
  setItems: (update: (items: T[]) => T[]) => void;
}

/**
 * Cursor-paginated list (`{ items, nextCursor }` envelopes). Pages are appended in order; a reload starts over and
 * discards responses from the previous generation so a slow page can never land in a fresh list.
 */
export function usePaged<T>(load: (cursor: string | undefined) => Promise<Page<T>>, deps: readonly unknown[] = [], enabled = true): Paged<T> {
  const [items, setItemsState] = useState<T[]>([]);
  const [status, setStatus] = useState<Paged<T>['status']>('loading');
  const [error, setError] = useState<unknown>(null);
  const [moreError, setMoreError] = useState<unknown>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nonce, setNonce] = useState(0);
  const generation = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (!enabled) return;
    const gen = ++generation.current;
    setStatus('loading');
    setError(null);
    setMoreError(null);
    loadRef.current(undefined).then(
      (page) => {
        if (gen !== generation.current) return;
        setItemsState(page.items);
        setCursor(page.nextCursor);
        setStatus('ready');
      },
      (e: unknown) => {
        if (gen !== generation.current) return;
        setError(e);
        setStatus('error');
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce, enabled]);

  const busy = useRef(false);
  const loadMore = useCallback(() => {
    if (!cursor || busy.current) return;
    busy.current = true;
    const gen = generation.current;
    setLoadingMore(true);
    setMoreError(null);
    loadRef.current(cursor)
      .then(
        (page) => {
          if (gen !== generation.current) return;
          setItemsState((prev) => [...prev, ...page.items]);
          setCursor(page.nextCursor);
        },
        (e: unknown) => gen === generation.current && setMoreError(e),
      )
      .finally(() => {
        busy.current = false;
        setLoadingMore(false);
      });
  }, [cursor]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const setItems = useCallback((update: (items: T[]) => T[]) => setItemsState(update), []);
  return { status, items, error, moreError, hasMore: !!cursor, loadingMore, reload, loadMore, setItems };
}
