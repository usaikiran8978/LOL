import { useTranslation } from 'react-i18next';
import { ApiError } from '../api/errors';
import { useErrorText } from '../hooks/useErrorText';
import { Notice } from './Notice';

/** Form-level error banner. Shows the request id so users can quote it to support. */
export function FormError({ error, testID = 'form-error' }: { error: unknown; testID?: string }) {
  const { t } = useTranslation();
  const text = useErrorText()(error);
  if (!text) return null;
  const ref = error instanceof ApiError && error.requestId ? t('errors.reference', { id: error.requestId }) : undefined;
  return <Notice tone="danger" title={text} body={ref} testID={testID} />;
}
