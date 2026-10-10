'use client';

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { t } from '@/i18n';
import { errorMessage, requestIdOf } from '@/lib/api/errors';
import { Button } from './Button';
import { TextField } from './fields';
import { FormError } from './states';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface DialogProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** Rendered as a <form> so Enter submits and the footer's submit button works natively. */
  onSubmit?: (e: FormEvent<HTMLFormElement>) => void;
  /** Prevents closing (Escape/backdrop) while a request is in flight. */
  busy?: boolean;
}

/**
 * Accessible modal: labelled by its title, traps Tab focus, closes on Escape, restores focus to the opener.
 * Implemented without <dialog>.showModal() because jsdom (tests) does not support it.
 */
export function Dialog({ title, onClose, children, footer, size = 'md', onSubmit, busy }: DialogProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);

  useEffect(() => {
    openerRef.current = document.activeElement;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>('[data-autofocus]') ?? panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();
    return () => {
      const opener = openerRef.current;
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (!busy) onClose();
      return;
    }
    if (e.key !== 'Tab' || !panelRef.current) return;
    const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  const body = (
    <>
      <header className="dialog__header">
        <h2 id={titleId} className="dialog__title">{title}</h2>
        <button type="button" className="dialog__close" onClick={onClose} disabled={busy} aria-label={t('common.close')}>×</button>
      </header>
      <div className="dialog__body">{children}</div>
      {footer ? <footer className="dialog__footer">{footer}</footer> : null}
    </>
  );

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className={`dialog dialog--${size}`} tabIndex={-1} onKeyDown={onKeyDown}>
        {onSubmit ? (
          <form noValidate onSubmit={(e) => { e.preventDefault(); onSubmit(e); }}>{body}</form>
        ) : body}
      </div>
    </div>
  );
}

interface ConfirmDialogProps {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  tone?: 'danger' | 'primary';
  /** Return false to keep the dialog open without an error (e.g. local validation failed). */
  onConfirm: () => Promise<void | boolean> | void | boolean;
  onClose: () => void;
  children?: ReactNode;
  /**
   * Irreversible actions: the admin must type this exact phrase (e.g. the target's ID or a keyword)
   * before the confirm button does anything.
   */
  confirmPhrase?: string;
}

/** Confirmation for destructive/publish actions; shows the server error inline and stays open on failure. */
export function ConfirmDialog({ title, body, confirmLabel, tone = 'primary', onConfirm, onClose, children, confirmPhrase }: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [typed, setTyped] = useState('');
  const [typedError, setTypedError] = useState<string | undefined>();

  async function confirm() {
    if (confirmPhrase !== undefined && typed.trim() !== confirmPhrase) {
      setTypedError(t('confirmText.mismatch'));
      return;
    }
    setTypedError(undefined);
    setBusy(true);
    setError(null);
    try {
      if ((await onConfirm()) === false) {
        setBusy(false);
        return;
      }
      onClose();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={title}
      onClose={onClose}
      size="sm"
      busy={busy}
      onSubmit={() => void confirm()}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy} data-autofocus>{t('common.cancel')}</Button>
          <Button type="submit" variant={tone} disabled={busy}>{busy ? t('common.saving') : confirmLabel}</Button>
        </>
      }
    >
      <div className="confirm__body">{body}</div>
      {children}
      {confirmPhrase !== undefined ? (
        <TextField
          label={t('confirmText.label', { phrase: confirmPhrase })}
          value={typed}
          onChange={setTyped}
          error={typedError}
          autoComplete="off"
          spellCheck={false}
          required
        />
      ) : null}
      {error ? <FormError message={errorMessage(error)} requestId={requestIdOf(error)} /> : null}
    </Dialog>
  );
}
