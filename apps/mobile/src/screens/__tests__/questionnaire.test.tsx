import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as Router from 'expo-router';
import { analytics } from '../../analytics';
import { question } from '../../test/builders';
import { user } from '../../test/fixtures';
import { apiError, mockApi } from '../../test/mockApi';
import { renderWithProviders, seedSession } from '../../test/render';
import QuestionnaireCategoryScreen from '../questionnaire/QuestionnaireCategoryScreen';
import QuestionnaireScreen from '../questionnaire/QuestionnaireScreen';

const router = (Router as unknown as { __router: { push: jest.Mock; back: jest.Mock } }).__router;
const params = (Router as unknown as { __params: Record<string, string> }).__params;
const base = () => ({ 'GET /users/me': { body: user() }, 'GET /users/me/consents': { body: [] } });
const status = (over = {}) => ({ body: { total: 2, answered: 0, requiredRemaining: 1, complete: false, ...over } });

beforeEach(async () => {
  await seedSession();
  router.push.mockClear();
  params.category = 'family';
});

describe('QuestionnaireScreen', () => {
  it('shows progress and categories, and opens a category', async () => {
    mockApi({ ...base(), 'GET /questions': { body: [question(), question({ questionId: 'q2', key: 'smoke', categoryKey: 'lifestyle', needsReanswer: true })] }, 'GET /questions/status': status() });
    renderWithProviders(<QuestionnaireScreen />);
    expect(await screen.findByText('0 of 2 answered')).toBeTruthy();
    expect(screen.getByTestId('questionnaire-required')).toBeTruthy();
    expect(screen.getByText('Updated questions to answer again: 1')).toBeTruthy();
    fireEvent.press(screen.getByTestId('category-family'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/questionnaire/[category]', params: { category: 'family' } });
  });

  it('shows the empty and error states', async () => {
    const api = mockApi({ ...base(), 'GET /questions': apiError(500, 'INTERNAL'), 'GET /questions/status': status() });
    const { unmount } = renderWithProviders(<QuestionnaireScreen />);
    expect(await screen.findByTestId('screen-error')).toBeTruthy();
    unmount();
    api.set('GET /questions', { body: [] });
    renderWithProviders(<QuestionnaireScreen />);
    expect(await screen.findByTestId('screen-empty')).toBeTruthy();
  });
});

describe('QuestionnaireCategoryScreen', () => {
  it('submits a choice answer with importance and a deal-breaker, then continues to the unlocked follow-up', async () => {
    const track = jest.spyOn(analytics, 'track');
    const followUp = question({ questionId: 'q-follow', key: 'kids_when', text: 'When?', answerType: 'text', allowDealbreaker: false, allowImportance: false, options: [] });
    const api = mockApi({ ...base(), 'GET /questions': { body: [question()] }, 'GET /questions/status': status(), 'POST /answers': { status: 201, body: { questionId: 'x', versionId: 'y' } } });
    renderWithProviders(<QuestionnaireCategoryScreen />);
    expect(await screen.findByText('Do you want children?')).toBeTruthy();
    expect(screen.getByTestId('q-save').props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByTestId('q-options-want'));
    fireEvent.press(screen.getByTestId('q-importance-3'));
    fireEvent(screen.getByTestId('q-dealbreaker'), 'valueChange', true);
    // A choice deal-breaker needs acceptable answers before it can be saved.
    expect(screen.getByTestId('q-save').props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByTestId('q-acceptable-want'));
    fireEvent.press(screen.getByTestId('q-acceptable-open'));
    // The server unlocks the conditional follow-up after this answer.
    api.set('GET /questions', { body: [question({ answer: { skipped: false, importance: 3, isDealbreaker: true, value: { optionKey: 'want' }, answeredAt: '2026-10-08T00:00:00Z' } }), followUp] });
    fireEvent.press(screen.getByTestId('q-save'));
    expect(await screen.findByText('When?')).toBeTruthy();
    expect(api.callsTo('POST /answers')[0]!.body).toEqual({
      questionId: question().questionId, versionId: question().versionId, value: { optionKey: 'want' }, importance: 3, isDealbreaker: true, acceptableOptionKeys: ['want', 'open'],
    });
    expect(track).toHaveBeenCalledWith('questionnaire_started', {});
    expect(track).toHaveBeenCalledWith('question_answered', { answerType: 'single_choice', skipped: false, category: 'family' });
  });

  it('skips where allowed and shows the review list when the category is done', async () => {
    const api = mockApi({ ...base(), 'GET /questions': { body: [question({ answerType: 'scale', options: [], allowDealbreaker: false, constraints: { ...question().constraints, scaleMin: 1, scaleMax: 5, scaleStep: 1 } })] }, 'GET /questions/status': status(), 'POST /answers': { status: 201, body: {} } });
    renderWithProviders(<QuestionnaireCategoryScreen />);
    fireEvent.press(await screen.findByTestId('q-skip'));
    expect(await screen.findByTestId('questionnaire-review')).toBeTruthy();
    expect(api.callsTo('POST /answers')[0]!.body).toEqual({ questionId: question().questionId, versionId: question().versionId, skip: true });
  });

  it('edits a previous answer from the review list (ranking question)', async () => {
    const ranked = question({ answerType: 'ranking', allowDealbreaker: false, allowImportance: false, answer: { skipped: false, importance: null, isDealbreaker: false, value: { rankedOptionKeys: ['want', 'open', 'dont_want'] }, answeredAt: '2026-10-08T00:00:00Z' } });
    const api = mockApi({ ...base(), 'GET /questions': { body: [ranked] }, 'GET /questions/status': status(), 'POST /answers': { status: 201, body: {} } });
    renderWithProviders(<QuestionnaireCategoryScreen />);
    fireEvent.press(await screen.findByTestId(`question-${ranked.key}`));
    fireEvent.press(screen.getByTestId('q-rank-down-want'));
    fireEvent.press(screen.getByTestId('q-save'));
    await waitFor(() => expect(api.callsTo('POST /answers')).toHaveLength(1));
    expect(api.callsTo('POST /answers')[0]!.body.value).toEqual({ rankedOptionKeys: ['open', 'want', 'dont_want'] });
  });

  it('submits a structured preference intact (own options + acceptable options)', async () => {
    const pref = question({ key: 'diet', text: 'Diet?', answerType: 'structured_preference', allowDealbreaker: true, allowImportance: false });
    const api = mockApi({ ...base(), 'GET /questions': { body: [pref] }, 'GET /questions/status': status(), 'POST /answers': { status: 201, body: { questionId: pref.questionId, versionId: pref.versionId } } });
    renderWithProviders(<QuestionnaireCategoryScreen />);
    fireEvent.press(await screen.findByTestId('q-options-want'));
    expect(screen.getByTestId('q-save').props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByTestId('q-acceptable-want'));
    fireEvent.press(screen.getByTestId('q-acceptable-open'));
    fireEvent(screen.getByTestId('q-dealbreaker'), 'valueChange', true);
    fireEvent.press(screen.getByTestId('q-save'));
    await waitFor(() => expect(api.callsTo('POST /answers')).toHaveLength(1));
    expect(api.callsTo('POST /answers')[0]!.body).toEqual({
      questionId: pref.questionId, versionId: pref.versionId, value: { optionKeys: ['want'], acceptableOptionKeys: ['want', 'open'] }, isDealbreaker: true,
    });
  });

  it('shows the unit of a numeric question and submits plain numbers', async () => {
    const height = question({ key: 'height', text: 'Preferred height?', answerType: 'numeric_range', options: [], allowDealbreaker: false, allowImportance: false, constraints: { ...question().constraints, numericMin: 140, numericMax: 220, numericUnit: 'cm' } });
    const api = mockApi({ ...base(), 'GET /questions': { body: [height] }, 'GET /questions/status': status(), 'POST /answers': { status: 201, body: {} } });
    renderWithProviders(<QuestionnaireCategoryScreen />);
    expect(await screen.findByText('Between 140 and 220 cm')).toBeTruthy();
    expect(screen.getByText('From (cm)')).toBeTruthy();
    fireEvent.changeText(screen.getByTestId('q-range-min'), '160');
    fireEvent.changeText(screen.getByTestId('q-range-max'), '185');
    fireEvent.press(screen.getByTestId('q-save'));
    await waitFor(() => expect(api.callsTo('POST /answers')[0]?.body.value).toEqual({ min: 160, max: 185 }));
  });

  it('refreshes when the question version is stale and shows invalid-answer errors', async () => {
    const api = mockApi({ ...base(), 'GET /questions': { body: [question({ allowDealbreaker: false })] }, 'GET /questions/status': status(), 'POST /answers': apiError(409, 'VERSION_STALE', { currentVersionId: 'v2' }) });
    renderWithProviders(<QuestionnaireCategoryScreen />);
    fireEvent.press(await screen.findByTestId('q-options-open'));
    fireEvent.press(screen.getByTestId('q-save'));
    expect(await screen.findByTestId('questionnaire-notice')).toBeTruthy();
    expect(api.callsTo('GET /questions').length).toBeGreaterThanOrEqual(2);

    api.set('POST /answers', apiError(400, 'ANSWER_INVALID', { reason: 'selection_count' }));
    fireEvent.press(screen.getByTestId('q-options-want'));
    fireEvent.press(screen.getByTestId('q-save'));
    expect(await screen.findByText("That answer isn't valid.")).toBeTruthy();
  });
});
