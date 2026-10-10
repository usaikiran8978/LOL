import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { legalApi, LEGAL_DOC_TYPES, type LegalDocType } from '../../api';
import { Markdown, Screen, Text } from '../../components';
import { useResource } from '../../hooks/useResource';
import { formatDate } from '../../i18n/format';

export default function LegalDocumentScreen() {
  const { t, i18n } = useTranslation();
  const params = useLocalSearchParams<{ type?: string; country?: string }>();
  const type = (LEGAL_DOC_TYPES as readonly string[]).includes(params.type ?? '') ? (params.type as LegalDocType) : null;
  const country = params.country && /^[A-Z]{2}$/.test(params.country) ? params.country : undefined;
  const doc = useResource(() => (type ? legalApi.get(type, country) : Promise.reject(new Error('unknown'))), [type, country, i18n.language]);

  if (!type) return <Screen status="empty" emptyTitle={t('legal.notFound')} />;
  return (
    <Screen title={doc.data?.title} status={doc.status === 'ready' ? 'ready' : doc.status} error={doc.error} onRetry={doc.reload} testID="legal-screen">
      {doc.data ? (
        <>
          <Text variant="caption" color="textMuted" style={{ marginBottom: 16 }}>
            {t('legal.versionInfo', { version: doc.data.version, date: formatDate(doc.data.effectiveAt) || t('legal.effectiveNow') })}
          </Text>
          <Markdown source={doc.data.bodyMarkdown} testID="legal-body" />
        </>
      ) : null}
    </Screen>
  );
}
