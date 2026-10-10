import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as Router from 'expo-router';
import { OnboardingProvider } from '../../onboarding/OnboardingContext';
import { onboarding, profile, user } from '../../test/fixtures';
import { apiError, mockApi } from '../../test/mockApi';
import { renderWithProviders, seedSession } from '../../test/render';
import OnboardingCompleteScreen from '../onboarding/OnboardingCompleteScreen';
import OnboardingStepScreen from '../onboarding/OnboardingStepScreen';

const router = (Router as unknown as { __router: { replace: jest.Mock; push: jest.Mock } }).__router;
const params = (Router as unknown as { __params: Record<string, string> }).__params;

const genderTerms = [
  { id: 'g-woman', kind: 'gender', key: 'woman', label: 'Woman', description: null, parentId: null, sensitive: false },
  { id: 'g-man', kind: 'gender', key: 'man', label: 'Man', description: null, parentId: null, sensitive: false },
];

function renderStep(step: string) {
  params.step = step;
  return renderWithProviders(
    <OnboardingProvider>
      <OnboardingStepScreen />
    </OnboardingProvider>,
  );
}

beforeEach(async () => {
  router.replace.mockClear();
  await seedSession();
});

describe('Onboarding step engine', () => {
  it('renders a data step, saves it, marks it complete and moves to the next step', async () => {
    const after = onboarding({ steps: onboarding().steps.map((s) => (s.key === 'gender' ? { ...s, completed: true } : s)), progress: 50, currentStep: 'orientation' });
    const api = mockApi({
      'GET /users/me': { body: user() },
      'GET /users/me/consents': { body: [] },
      'GET /onboarding': { body: onboarding() },
      'GET /profiles/me': { body: profile() },
      'GET /catalog/taxonomy': { body: genderTerms },
      'PUT /profiles/me': { body: profile() },
      'PUT /onboarding/step': { body: after },
    });
    renderStep('gender');
    expect(await screen.findByText('Your gender')).toBeTruthy();
    expect(screen.getByText('Step 2 of 4')).toBeTruthy();
    expect(screen.getByTestId('onboarding-progress').props.accessibilityValue).toMatchObject({ now: 25 });
    // Required step: no skip.
    expect(screen.queryByTestId('onboarding-skip')).toBeNull();

    fireEvent.press(await screen.findByTestId('term-gender-g-woman'));
    fireEvent.press(screen.getByTestId('term-save'));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/onboarding/orientation'));
    expect(api.callsTo('PUT /profiles/me')[0]!.body).toEqual({ genderId: 'g-woman' });
    expect(api.callsTo('PUT /onboarding/step')[0]!.body).toEqual({ step: 'gender', complete: true });
    expect(api.callsTo('GET /catalog/taxonomy')[0]!.query.get('kinds')).toBe('gender');
  });

  it('shows the server reason when a step check fails', async () => {
    mockApi({
      'GET /users/me': { body: user() },
      'GET /users/me/consents': { body: [] },
      'GET /onboarding': { body: onboarding() },
      'GET /profiles/me': { body: profile() },
      'GET /catalog/taxonomy': { body: genderTerms },
      'PUT /profiles/me': { body: profile() },
      'PUT /onboarding/step': apiError(400, 'ONBOARDING_STEP_INVALID', { step: 'gender', reason: 'onboarding.missing.gender_id' }),
    });
    renderStep('gender');
    fireEvent.press(await screen.findByTestId('term-gender-g-man'));
    fireEvent.press(screen.getByTestId('term-save'));
    expect(await screen.findByText('Choose an option to continue.')).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('optional steps can be skipped locally and the flow moves on', async () => {
    mockApi({
      'GET /users/me': { body: user() },
      'GET /users/me/consents': { body: [] },
      'GET /onboarding': { body: onboarding({ currentStep: 'orientation' }) },
      'GET /profiles/me': { body: profile() },
      'GET /catalog/taxonomy': { body: [] },
    });
    renderStep('orientation');
    fireEvent.press(await screen.findByTestId('onboarding-skip'));
    expect(router.replace).toHaveBeenCalledWith('/onboarding/questionnaire');
  });

  it('questionnaire step links to the questionnaire and only continues once required questions are answered', async () => {
    const done = onboarding({ steps: onboarding().steps.map((s) => ({ ...s, completed: s.required })), canComplete: true, currentStep: null, progress: 75 });
    const api = mockApi({
      'GET /users/me': { body: user() },
      'GET /users/me/consents': { body: [] },
      'GET /onboarding': { body: onboarding() },
      'GET /questions/status': { body: { total: 4, answered: 1, requiredRemaining: 2, complete: false } },
      'PUT /onboarding/step': { body: done },
    });
    const { unmount } = renderStep('questionnaire');
    expect(await screen.findByTestId('questionnaire-required')).toBeTruthy();
    expect(screen.getByTestId('ack-continue').props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByTestId('open-questionnaire'));
    expect(router.push).toHaveBeenCalledWith('/questionnaire');
    unmount();

    api.set('GET /questions/status', { body: { total: 4, answered: 3, requiredRemaining: 0, complete: true } });
    renderStep('questionnaire');
    await waitFor(() => expect(screen.getByTestId('ack-continue').props.accessibilityState.disabled).toBe(false));
    fireEvent.press(screen.getByTestId('ack-continue'));
    // Only an optional step remains behind us, so the flow goes to the completion summary.
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/onboarding/complete'));
    expect(api.callsTo('PUT /onboarding/step')[0]!.body).toEqual({ step: 'questionnaire', complete: true });
  });

  it('renders unknown admin-defined steps with the generic acknowledgement', async () => {
    const state = onboarding({ steps: [...onboarding().steps, { key: 'mystery_step', required: false, applicable: true, completed: false }] });
    mockApi({ 'GET /users/me': { body: user() }, 'GET /users/me/consents': { body: [] }, 'GET /onboarding': { body: state } });
    renderStep('mystery_step');
    expect(await screen.findByTestId('generic-step')).toBeTruthy();
    expect(screen.getByText('One more thing')).toBeTruthy();
  });

  it('"Finish later" saves a draft for resume', async () => {
    const api = mockApi({
      'GET /users/me': { body: user() },
      'GET /users/me/consents': { body: [] },
      'GET /onboarding': { body: onboarding({ currentStep: 'profile_basics' }) },
      'GET /profiles/me': { body: profile({ displayName: null }) },
      'GET /catalog/taxonomy': { body: [] },
      'PUT /onboarding/step': { body: onboarding() },
    });
    renderStep('profile_basics');
    fireEvent.changeText(await screen.findByTestId('displayName'), 'Alex');
    fireEvent.press(screen.getByTestId('onboarding-later'));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/home'));
    const body = api.callsTo('PUT /onboarding/step')[0]!.body;
    expect(body).toMatchObject({ step: 'profile_basics', complete: false, draft: { step: 'profile_basics', values: { displayName: 'Alex' } } });
  });
});

describe('Onboarding completion', () => {
  it('lists missing required steps and disables finishing', async () => {
    mockApi({ 'GET /users/me': { body: user() }, 'GET /users/me/consents': { body: [] }, 'GET /onboarding': { body: onboarding() } });
    renderWithProviders(
      <OnboardingProvider>
        <OnboardingCompleteScreen />
      </OnboardingProvider>,
    );
    expect(await screen.findByTestId('onboarding-missing')).toBeTruthy();
    expect(screen.getByTestId('summary-gender').props.accessibilityLabel).toContain('Needed');
    expect(screen.getByTestId('onboarding-finish').props.accessibilityState.disabled).toBe(true);
  });

  it('completes and goes home', async () => {
    const ready = onboarding({ steps: onboarding().steps.map((s) => ({ ...s, completed: true })), canComplete: true, progress: 100 });
    const api = mockApi({
      'GET /users/me': { body: user() },
      'GET /users/me/consents': { body: [] },
      'GET /onboarding': { body: ready },
      'POST /onboarding/complete': { body: { ...ready, completedAt: '2026-10-08T00:00:00.000Z' } },
    });
    renderWithProviders(
      <OnboardingProvider>
        <OnboardingCompleteScreen />
      </OnboardingProvider>,
    );
    fireEvent.press(await screen.findByTestId('onboarding-finish'));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/home'));
    expect(api.callsTo('POST /onboarding/complete')).toHaveLength(1);
  });
});
