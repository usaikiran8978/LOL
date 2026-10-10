import { useTranslation } from 'react-i18next';
import { errorMessage } from '../api/errors';

/** Localized, user-facing text for any caught error (null when there is none). */
export function useErrorText() {
  const { t } = useTranslation();
  return (e: unknown): string | null => {
    if (!e) return null;
    const { key, params } = errorMessage(e);
    return t(key, params);
  };
}
