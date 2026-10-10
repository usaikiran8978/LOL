'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { t } from '@/i18n';
import { errorMessage, requestIdOf } from '@/lib/api/errors';
import { Button } from './Button';

export function LoadingState({ label }: { label?: string }) {
  return (
    <div className="state state--loading" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{label ?? t('app.loading')}</span>
    </div>
  );
}

export function ErrorState({ error, onRetry, title }: { error: unknown; onRetry?: () => void; title?: string }) {
  const requestId = requestIdOf(error);
  return (
    <div className="state state--error" role="alert">
      <h2 className="state__title">{title ?? t('states.errorTitle')}</h2>
      <p>{errorMessage(error)}</p>
      {requestId ? <p className="muted">{t('common.requestId', { id: requestId })}</p> : null}
      {onRetry ? <Button variant="secondary" onClick={onRetry}>{t('common.retry')}</Button> : null}
    </div>
  );
}

export function EmptyState({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div className="state state--empty">
      <p>{message}</p>
      {action}
    </div>
  );
}

/** Form-level error summary; focused on appearance so keyboard/screen-reader users land on it. */
export function FormError({ message, requestId }: { message: string; requestId?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), [message]);
  return (
    <div ref={ref} className="alert alert--error" role="alert" tabIndex={-1}>
      <p>{message}</p>
      {requestId ? <p className="muted">{t('common.requestId', { id: requestId })}</p> : null}
    </div>
  );
}

export function PageHeader({ title, intro, actions }: { title: string; intro?: string; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h1 className="page-header__title">{title}</h1>
        {intro ? <p className="page-header__intro">{intro}</p> : null}
      </div>
      {actions ? <div className="page-header__actions">{actions}</div> : null}
    </div>
  );
}

export function StatusBadge({ status }: { status: 'draft' | 'published' | 'archived' }) {
  return <span className={`badge badge--${status}`}>{t(`status.${status}`)}</span>;
}

export function BoolBadge({ value, on, off }: { value: boolean | null | undefined; on?: string; off?: string }) {
  return <span className={`badge ${value ? 'badge--on' : 'badge--off'}`}>{value ? (on ?? t('common.yes')) : (off ?? t('common.no'))}</span>;
}
