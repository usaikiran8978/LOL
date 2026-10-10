'use client';

import type { ReactNode } from 'react';
import { t } from '@/i18n';
import { errorMessage, requestIdOf } from '@/lib/api/errors';
import type { FieldErrors } from '@/lib/forms/validate';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { FormError } from './states';

interface Props {
  title: string;
  onClose: () => void;
  onSubmit: () => void;
  busy: boolean;
  error: unknown;
  fieldErrors: FieldErrors;
  submitLabel?: string;
  size?: 'sm' | 'md' | 'lg';
  children: ReactNode;
}

/** Edit/create dialog with a consistent error summary and Save/Cancel footer. */
export function FormDialog({ title, onClose, onSubmit, busy, error, fieldErrors, submitLabel, size = 'md', children }: Props) {
  const count = Object.keys(fieldErrors).length;
  return (
    <Dialog
      title={title}
      onClose={onClose}
      onSubmit={onSubmit}
      busy={busy}
      size={size}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
          <Button type="submit" disabled={busy}>{busy ? t('common.saving') : (submitLabel ?? t('common.save'))}</Button>
        </>
      }
    >
      {error ? <FormError message={errorMessage(error)} requestId={requestIdOf(error)} /> : null}
      {!error && count > 0 ? <FormError message={t('validation.formHasErrors', { count })} /> : null}
      {children}
    </Dialog>
  );
}
