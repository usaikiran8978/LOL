import type { AnswerType, AnswerValue, submitAnswer } from '@amora/shared';
import type { z } from 'zod';
import { client } from './index';

// Shapes mirror apps/api/src/modules/questionnaire/questionnaire.service.ts (applicable(), status(), submit()).

export type { AnswerType, AnswerValue };

export interface Question {
  questionId: string;
  key: string;
  categoryKey: string;
  versionId: string;
  answerType: AnswerType;
  text: string;
  helpText: string | null;
  scaleMinLabel: string | null;
  scaleMaxLabel: string | null;
  isRequired: boolean;
  allowImportance: boolean;
  allowDealbreaker: boolean;
  /** Already false for required questions. */
  allowSkip: boolean;
  constraints: {
    minSelections: number | null;
    maxSelections: number | null;
    scaleMin: number | null;
    scaleMax: number | null;
    scaleStep: number | null;
    numericMin: number | null;
    numericMax: number | null;
    /** Free-text unit for numeric questions as configured by the admin (e.g. "cm"); null when unitless. */
    numericUnit: string | null;
    textMaxLength: number | null;
  };
  options: Array<{ key: string; label: string; isExclusive: boolean }>;
  /** Current answer for this exact version (null when unanswered or answered on an older version). */
  answer: null | { skipped: boolean; importance: number | null; isDealbreaker: boolean; value: AnswerValue | null; answeredAt: string };
  needsReanswer: boolean;
}

export interface QuestionnaireStatus {
  total: number;
  answered: number;
  requiredRemaining: number;
  complete: boolean;
}

export type SubmitAnswer = z.input<typeof submitAnswer>;

export const questionnaireApi = {
  /** Applicable questions only: conditional questions are evaluated server-side, so refetch after answering. */
  questions: (locale: string) => client.get<Question[]>('/questions', { query: { locale } }),
  status: () => client.get<QuestionnaireStatus>('/questions/status'),
  submit: (b: SubmitAnswer) => client.post<{ questionId: string; versionId: string }>('/answers', b),
};
