'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { t } from '@/i18n';

type Tone = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  tone: Tone;
  title: string;
  message?: string;
}
interface ToastApi {
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
}

const DURATION_MS = 6000;
const MAX_VISIBLE = 4;
const ICON: Record<Tone, string> = { success: '✓', error: '!', info: '♥' };

const ToastContext = createContext<ToastApi>({ success: () => {}, error: () => {}, info: () => {} });

/**
 * App-wide toasts in one polite live region (errors use an assertive one). Auto-dismiss after 6 s, pause on hover,
 * dismissible with the close button; at most four are stacked.
 */
export function NoticeProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((list) => list.filter((x) => x.id !== id));
  }, []);
  const schedule = useCallback((id: number) => timers.current.set(id, setTimeout(() => dismiss(id), DURATION_MS)), [dismiss]);

  const push = useCallback(
    (tone: Tone, title: string, message?: string) => {
      seq.current += 1;
      const id = seq.current;
      setToasts((list) => [...list, { id, tone, title, message }].slice(-MAX_VISIBLE));
      schedule(id);
    },
    [schedule],
  );
  const api = useMemo<ToastApi>(() => ({ success: (a, b) => push('success', a, b), error: (a, b) => push('error', a, b), info: (a, b) => push('info', a, b) }), [push]);

  const render = (tone: 'polite' | 'assertive') =>
    toasts
      .filter((x) => (x.tone === 'error') === (tone === 'assertive'))
      .map((x) => (
        <div
          key={x.id}
          className={`toast toast--${x.tone}`}
          onMouseEnter={() => clearTimeout(timers.current.get(x.id))}
          onMouseLeave={() => schedule(x.id)}
        >
          <span className="toast__icon" aria-hidden="true">{ICON[x.tone]}</span>
          <div className="toast__body">
            <p className="toast__title">{x.title}</p>
            {x.message ? <p className="toast__message">{x.message}</p> : null}
          </div>
          <button type="button" className="toast__close" onClick={() => dismiss(x.id)} aria-label={t('common.close')}>×</button>
          <span className="toast__timer" aria-hidden="true" style={{ animationDuration: `${DURATION_MS}ms` }} />
        </div>
      ));

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* Live regions stay mounted so screen readers announce changes reliably. */}
      <div className="notice-region">
        <div role="status" aria-live="polite">{render('polite')}</div>
        <div aria-live="assertive">{render('assertive')}</div>
      </div>
    </ToastContext.Provider>
  );
}

/** Success announcement (kept for the existing call sites). */
export function useNotify(): (message: string) => void {
  return useContext(ToastContext).success;
}

/** Success / error / info toasts. */
export function useToast(): ToastApi {
  return useContext(ToastContext);
}
