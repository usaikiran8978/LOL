'use client';

import { useState, type ReactNode } from 'react';
import type { z } from 'zod';
import { useNotify } from '@/components/shell/notice';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { t } from '@/i18n';
import { useFormSubmit } from '@/lib/forms/useFormSubmit';
import { validate, type FieldErrors } from '@/lib/forms/validate';

/**
 * Catalogue edits (products, prices, free-tier limits, coupons) apply to live users immediately, so a save is
 * validated with the shared contract first and only sent after an explicit confirmation. Request failures
 * (including server field errors) surface in the calling form dialog.
 */
export function useLiveSave(onSaved: () => void) {
  const form = useFormSubmit();
  const notify = useNotify();
  const [pending, setPending] = useState<(() => Promise<unknown>) | null>(null);

  function review<S extends z.ZodType>(schema: S, value: unknown, fn: (data: z.output<S>) => Promise<unknown>, extraErrors: FieldErrors = {}) {
    const v = validate(schema, value);
    const errors = { ...(v.ok ? {} : v.errors), ...extraErrors };
    if (!v.ok || Object.keys(errors).length) {
      form.setFieldErrors(errors);
      return;
    }
    form.setFieldErrors({});
    const data = v.data;
    setPending(() => () => fn(data));
  }

  const confirmDialog: ReactNode = pending ? (
    <ConfirmDialog
      title={t('billing.confirmLiveTitle')}
      body={t('billing.confirmLiveBody')}
      confirmLabel={t('billing.confirmLiveAction')}
      onConfirm={async () => {
        const ok = await form.send(pending);
        if (ok) {
          notify(t('common.saved'));
          onSaved();
        }
      }}
      onClose={() => setPending(null)}
    />
  ) : null;

  return { busy: form.busy, error: form.error, fieldErrors: form.fieldErrors, setFieldErrors: form.setFieldErrors, review, confirmDialog };
}
