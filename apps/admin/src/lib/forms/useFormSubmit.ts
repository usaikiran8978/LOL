'use client';

import { useCallback, useState } from 'react';
import type { z } from 'zod';
import { apiFieldErrors } from '../api/errors';
import { validate, type FieldErrors } from './validate';

/**
 * Client-side validation with a shared contract, then the request; server VALIDATION_FAILED details are
 * mapped back onto fields. Returns true on success so callers can close dialogs / notify.
 */
export function useFormSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const send = useCallback(async (fn: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setError(e);
      setFieldErrors(apiFieldErrors(e));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const submit = useCallback(
    async <S extends z.ZodType>(schema: S, value: unknown, fn: (data: z.output<S>) => Promise<unknown>, extraErrors: FieldErrors = {}): Promise<boolean> => {
      const v = validate(schema, value);
      const errors = { ...(v.ok ? {} : v.errors), ...extraErrors };
      if (!v.ok || Object.keys(errors).length) {
        setError(null);
        setFieldErrors(errors);
        return false;
      }
      setFieldErrors({});
      return send(() => fn(v.data));
    },
    [send],
  );

  return { busy, error, fieldErrors, setFieldErrors, submit, send };
}
