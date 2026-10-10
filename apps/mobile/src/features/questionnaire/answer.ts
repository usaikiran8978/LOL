import { analytics } from '../../analytics';
import { questionnaireApi, type Question, type QuestionnaireStatus } from '../../api/questionnaire';
import { acceptableFor, toValue, type AnswerDraft } from './QuestionInput';

/** Submit (or skip) one answer and report progress analytics. Returns the fresh status. */
export async function submitAnswer(q: Question, draft: AnswerDraft | null, before: QuestionnaireStatus | undefined): Promise<QuestionnaireStatus> {
  if (draft === null) {
    await questionnaireApi.submit({ questionId: q.questionId, versionId: q.versionId, skip: true });
  } else {
    const value = toValue(q, draft);
    if (!value) throw new Error('incomplete answer');
    await questionnaireApi.submit({
      questionId: q.questionId,
      versionId: q.versionId,
      value,
      importance: q.allowImportance && draft.importance !== null ? draft.importance : undefined,
      isDealbreaker: q.allowDealbreaker ? draft.dealbreaker : false,
      acceptableOptionKeys: q.allowDealbreaker ? acceptableFor(q, draft) : undefined,
    });
  }
  if (before && before.answered === 0 && !q.answer) analytics.track('questionnaire_started', {});
  analytics.track('question_answered', { answerType: q.answerType, skipped: draft === null, category: q.categoryKey });
  const status = await questionnaireApi.status();
  if (status.complete && before && !before.complete) analytics.track('questionnaire_completed', { answered: status.answered, total: status.total });
  return status;
}

export function groupByCategory(questions: Question[]): Array<{ key: string; questions: Question[] }> {
  const out: Array<{ key: string; questions: Question[] }> = [];
  for (const q of questions) {
    const g = out.find((x) => x.key === q.categoryKey);
    if (g) g.questions.push(q);
    else out.push({ key: q.categoryKey, questions: [q] });
  }
  return out;
}
