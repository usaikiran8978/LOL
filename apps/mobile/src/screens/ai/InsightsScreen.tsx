import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { aiApi, AI_FLAGS, type InsightsResult } from '../../api/ai';
import { Button, Screen, Text } from '../../components';
import { useFlag } from '../../config/ConfigProvider';
import { AiStatus, useAi } from '../../features/ai/useAi';
import { useTheme } from '../../theme/ThemeProvider';

/** Relationship insights (premium AI): generated on request, never automatically. */
export default function InsightsScreen() {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const enabled = useFlag(AI_FLAGS.insights);
  const [result, setResult] = useState<InsightsResult | null>(null);
  const insights = useAi('relationship_insights', async () => {
    const r = await aiApi.relationshipInsights();
    setResult(r);
    return r;
  });
  if (!enabled) return <Screen title={t('ai.insightsTitle')} status="empty" emptyTitle={t('ai.notConfiguredTitle')} emptyBody={t('ai.unavailableBody')} testID="insights-screen" />;
  return (
    <Screen title={t('ai.insightsTitle')} subtitle={t('ai.insightsIntro')} testID="insights-screen">
      <AiStatus ai={insights} surface="relationship_insights" />
      <Button testID="insights-run" label={t(result ? 'ai.again' : 'ai.getInsights')} onPress={() => void insights.run()} loading={insights.pending} />
      {result ? (
        <View testID="insights-result" style={{ marginTop: spacing.xl }}>
          {result.insights.map((i) => (
            <View key={i.title} style={{ marginBottom: spacing.lg }}>
              <Text variant="heading">{i.title}</Text>
              <Text>{i.detail}</Text>
            </View>
          ))}
          <Text variant="caption" color="textMuted">{t('ai.disclaimer')}</Text>
        </View>
      ) : null}
    </Screen>
  );
}
