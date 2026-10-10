import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { questionnaireApi } from '../../api/questionnaire';
import { Badge, ListItem, Notice, ProgressBar, Screen, Text } from '../../components';
import { groupByCategory } from '../../features/questionnaire/answer';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';
import { useResource } from '../../hooks/useResource';
import { formatNumber } from '../../i18n/format';
import { useTheme } from '../../theme/ThemeProvider';
import { humanizeKey } from '../../utils/text';

/** Questionnaire overview: progress and categories; each category opens the answer flow (also used to edit answers). */
export default function QuestionnaireScreen() {
  const { t, i18n } = useTranslation();
  const { spacing } = useTheme();
  const router = useRouter();
  const data = useResource(async () => {
    const [questions, status] = await Promise.all([questionnaireApi.questions(i18n.language), questionnaireApi.status()]);
    return { questions, status };
  }, [i18n.language]);
  useRefreshOnFocus(data.reload);
  const d = data.data;
  const groups = d ? groupByCategory(d.questions) : [];
  const needsReanswer = d?.questions.filter((q) => q.needsReanswer).length ?? 0;
  const pct = d && d.status.total ? Math.round((d.status.answered / d.status.total) * 100) : 0;

  return (
    <Screen
      title={t('questionnaire.title')}
      subtitle={t('questionnaire.intro')}
      status={d ? (d.questions.length ? 'ready' : 'empty') : data.status}
      error={data.error}
      onRetry={data.reload}
      emptyTitle={t('questionnaire.emptyTitle')}
      emptyBody={t('questionnaire.emptyBody')}
      testID="questionnaire-screen"
    >
      {d ? (
        <View>
          <ProgressBar testID="questionnaire-progress" value={pct} label={t('questionnaire.progress', { answered: formatNumber(d.status.answered), total: formatNumber(d.status.total) })} />
          <Text variant="caption" color="textMuted" style={{ marginTop: spacing.xs, marginBottom: spacing.lg }}>
            {t('questionnaire.progress', { answered: formatNumber(d.status.answered), total: formatNumber(d.status.total) })}
          </Text>
          {d.status.complete ? <Notice tone="success" title={t('questionnaire.complete')} testID="questionnaire-complete" /> : null}
          {d.status.requiredRemaining > 0 ? <Notice tone="warning" title={t('questionnaire.requiredRemaining', { count: formatNumber(d.status.requiredRemaining) })} testID="questionnaire-required" /> : null}
          {needsReanswer > 0 ? <Notice tone="warning" title={t('questionnaire.needsReanswer', { count: formatNumber(needsReanswer) })} /> : null}
          {groups.map((g) => {
            const answered = g.questions.filter((q) => q.answer).length;
            return (
              <View key={g.key}>
                <ListItem
                  testID={`category-${g.key}`}
                  label={t(`questionnaire.categories.${g.key}`, { defaultValue: humanizeKey(g.key) })}
                  value={t('questionnaire.categoryProgress', { answered: formatNumber(answered), total: formatNumber(g.questions.length) })}
                  onPress={() => router.push({ pathname: '/questionnaire/[category]', params: { category: g.key } })}
                />
                {g.questions.some((q) => q.needsReanswer) ? <Badge tone="warning" label={t('questionnaire.state.needsReanswer')} /> : null}
              </View>
            );
          })}
        </View>
      ) : null}
    </Screen>
  );
}
