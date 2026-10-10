'use client';

import type { Page } from '@amora/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

export interface CursorList<T> {
  status: 'loading' | 'error' | 'ready';
  items: T[];
  error: unknown;
  hasMore: boolean;
  moreBusy: boolean;
  moreError: unknown;
  loadMore: () => Promise<void>;
  reload: () => void;
}

/**
 * Cursor-paginated list (`{ items, nextCursor }`): first page on mount / when `deps` change, then
 * "load more" appends. Responses for a superseded dependency set are ignored.
 */
export function useCursorList<T>(load: (cursor: string | undefined) => Promise<Page<T>>, deps: readonly unknown[]): CursorList<T> {
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading');
  const [error, setError] = useState<unknown>(null);
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreError, setMoreError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  const generation = useRef(0);

  useEffect(() => {
    const gen = ++generation.current;
    setStatus('loading');
    setMoreError(null);
    loadRef.current(undefined).then(
      (page) => {
        if (gen !== generation.current) return;
        setItems(page.items);
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
  }, [...deps, nonce]);

  const loadMore = useCallback(async () => {
    if (!cursor) return;
    const gen = generation.current;
    setMoreBusy(true);
    setMoreError(null);
    try {
      const page = await loadRef.current(cursor);
      if (gen !== generation.current) return;
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } catch (e) {
      if (gen === generation.current) setMoreError(e);
    } finally {
      setMoreBusy(false);
    }
  }, [cursor]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { status, items, error, hasMore: !!cursor, moreBusy, moreError, loadMore, reload };
}
