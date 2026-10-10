import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { isApiError } from '../../api';
import { questionnaireApi, type Question, type QuestionnaireStatus } from '../../api/questionnaire';
import { Button, FormError, Notice, ProgressBar, Screen, Text } from '../../components';
import { submitAnswer } from '../../features/questionnaire/answer';
import { draftComplete, initialDraft, QuestionInput, QuestionRow, type AnswerDraft } from '../../features/questionnaire/QuestionInput';
import { useAction } from '../../hooks/useAction';
import { useResource } from '../../hooks/useResource';
import { formatNumber } from '../../i18n/format';
import { useTheme } from '../../theme/ThemeProvider';
import { humanizeKey } from '../../utils/text';

/**
 * Answers one category, a question at a time. Conditional questions are resolved by the server, so the list is
 * refetched after every answer and the flow continues with the question that follows the one just answered.
 */
export default function QuestionnaireCategoryScreen() {
  const { t, i18n } = useTranslation();
  const { spacing } = useTheme();
  const router = useRouter();
  const { category } = useLocalSearchParams<{ category: string }>();
  const data = useResource(async () => {
    const [questions, status] = await Promise.all([questionnaireApi.questions(i18n.language), questionnaireApi.status()]);
    return { questions, status };
  }, [i18n.language]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [mode, setMode] = useState<'answer' | 'review'>('answer');
  const [notice, setNotice] = useState<string | null>(null);

  const questions = useMemo(() => data.data?.questions.filter((q) => q.categoryKey === category) ?? [], [data.data, category]);

  // Start at the first unanswered (or needs-reanswer) question; review mode when everything is answered.
  useEffect(() => {
    if (!data.data || currentId || mode !== 'answer') return;
    const first = questions.find((q) => !q.answer);
    if (first) setCurrentId(first.questionId);
    else setMode('review');
  }, [data.data, questions, currentId, mode]);

  const index = questions.findIndex((q) => q.questionId === currentId);
  const current = index >= 0 ? questions[index] : undefined;
  const label = t(`questionnaire.categories.${category}`, { defaultValue: humanizeKey(category ?? '') });

  const advance = async (fromId: string, status: QuestionnaireStatus) => {
    const fresh = await questionnaireApi.questions(i18n.language);
    data.setData({ questions: fresh, status });
    const inCat = fresh.filter((q) => q.categoryKey === category);
    const at = inCat.findIndex((q) => q.questionId === fromId);
    const next = inCat.slice(at + 1).find((q) => !q.answer) ?? inCat.slice(at + 1)[0];
    if (next && mode === 'answer') setCurrentId(next.questionId);
    else {
      setCurrentId(null);
      setMode('review');
    }
  };

  const save = useAction(async (q: Question, draft: AnswerDraft | null) => {
    setNotice(null);
    try {
      const status = await submitAnswer(q, draft, data.data?.status);
      await advance(q.questionId, status);
    } catch (e) {
      // The question changed (new version) or no longer applies: refresh and let the user continue.
      if (isApiError(e, 'VERSION_STALE') || isApiError(e, 'QUESTION_NOT_APPLICABLE')) {
        setNotice(t(isApiError(e, 'VERSION_STALE') ? 'questionnaire.updatedNotice' : 'questionnaire.notApplicableNotice'));
        const fresh = await questionnaireApi.questions(i18n.language);
        data.setData({ questions: fresh, status: data.data!.status });
        if (!fresh.some((x) => x.questionId === q.questionId)) setCurrentId(null);
        return;
      }
      throw e;
    }
  });

  const answeredCount = questions.filter((q) => q.answer).length;

  return (
    <Screen
      title={label}
      status={data.data ? (questions.length ? 'ready' : 'empty') : data.status}
      error={data.error}
      onRetry={data.reload}
      emptyTitle={t('questionnaire.categoryEmpty')}
      emptyAction={{ label: t('common.back'), onPress: () => router.back() }}
      testID="questionnaire-category-screen"
    >
      <ProgressBar value={questions.length ? (answeredCount / questions.length) * 100 : 0} label={t('questionnaire.categoryProgress', { answered: formatNumber(answeredCount), total: formatNumber(questions.length) })} />
      <Text variant="caption" color="textMuted" style={{ marginTop: spacing.xs, marginBottom: spacing.lg }}>
        {t('questionnaire.categoryProgress', { answered: formatNumber(answeredCount), total: formatNumber(questions.length) })}
      </Text>
      {notice ? <Notice tone="warning" title={notice} testID="questionnaire-notice" /> : null}
      {current ? (
        <AnswerCard key={`${current.questionId}:${current.versionId}`} question={current} pending={save.pending} error={save.error} onSave={(d) => void save.run(current, d)} onSkip={() => void save.run(current, null)} />
      ) : (
        <View testID="questionnaire-review">
          <Notice tone="success" title={t('questionnaire.categoryDone')} />
          {questions.map((q) => (
            <QuestionRow
              key={q.questionId}
              question={q}
              onPress={() => {
                save.reset();
                setMode('review');
                setCurrentId(q.questionId);
              }}
            />
          ))}
          <Button label={t('common.done')} onPress={() => router.back()} style={{ marginTop: spacing.lg }} testID="questionnaire-done" />
        </View>
      )}
    </Screen>
  );
}

function AnswerCard({ question: q, pending, error, onSave, onSkip }: { question: Question; pending: boolean; error: unknown; onSave: (d: AnswerDraft) => void; onSkip: () => void }) {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const [draft, setDraft] = useState(() => initialDraft(q));
  return (
    <View testID={`answer-${q.key}`}>
      <Text variant="title" style={{ marginBottom: spacing.xs }}>
        {q.text}
      </Text>
      {q.helpText ? (
        <Text color="textMuted" style={{ marginBottom: spacing.md }}>
          {q.helpText}
        </Text>
      ) : null}
      {q.isRequired ? (
        <Text variant="caption" color="textMuted" style={{ marginBottom: spacing.md }}>
          {t('questionnaire.required')}
        </Text>
      ) : null}
      {q.needsReanswer ? <Notice tone="warning" title={t('questionnaire.reanswerHint')} /> : null}
      <QuestionInput question={q} draft={draft} onChange={setDraft} />
      <FormError error={error} />
      <View style={{ gap: spacing.sm, marginTop: spacing.lg }}>
        <Button testID="q-save" label={t('questionnaire.saveNext')} disabled={!draftComplete(q, draft)} loading={pending} onPress={() => onSave(draft)} />
        {q.allowSkip ? <Button testID="q-skip" variant="ghost" label={t('questionnaire.skip')} disabled={pending} onPress={onSkip} /> : null}
      </View>
    </View>
  );
}
