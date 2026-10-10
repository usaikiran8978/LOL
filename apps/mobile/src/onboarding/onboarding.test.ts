import { onboarding } from '../test/fixtures';
import { missingRequired, nextStep, previousStep, resumeStep, stepPosition } from './navigation';
import { KNOWN_STEP_KEYS, resolveStep } from './registry';
import { GenericAckStep, QuestionnaireStep } from './steps/AckSteps';

describe('onboarding step registry', () => {
  it('maps every step key the API seeds/knows to a dedicated screen', () => {
    const seeded = ['profile_basics', 'location', 'gender', 'orientation', 'dating_intent', 'relationship_goal', 'preferences', 'interests', 'lifestyle', 'family', 'values', 'communication_style', 'languages', 'photos', 'prompts', 'questionnaire', 'permissions', 'verification'];
    for (const key of seeded) {
      const def = resolveStep(key);
      expect(def.known).toBe(true);
      expect(def.titleKey).toBe(`onboarding.steps.${key}.title`);
    }
    expect([...KNOWN_STEP_KEYS].sort()).toEqual([...seeded].sort());
    expect(resolveStep('questionnaire').Component).toBe(QuestionnaireStep);
  });

  it('renders unknown admin-defined steps as a generic acknowledgement', () => {
    const def = resolveStep('brand_new_step');
    expect(def.known).toBe(false);
    expect(def.Component).toBe(GenericAckStep);
    expect(def.titleKey).toBe('onboarding.steps.generic.title');
  });
});

describe('onboarding navigation', () => {
  const state = onboarding();

  it('resumes at the server current step', () => {
    expect(resumeStep(state)).toBe('gender');
    expect(resumeStep({ ...state, completedAt: '2026-01-01T00:00:00Z' })).toBeNull();
  });

  it('moves to the next incomplete step, honouring skipped optional steps', () => {
    expect(nextStep(state, 'gender')).toBe('orientation');
    expect(nextStep(state, 'gender', new Set(['orientation']))).toBe('questionnaire');
    expect(resumeStep({ ...state, currentStep: 'orientation' }, new Set(['orientation']))).toBe('gender');
  });

  it('returns to missing required steps before finishing, then to completion', () => {
    expect(nextStep(state, 'questionnaire')).toBe('gender');
    const done = onboarding({ steps: state.steps.map((s) => ({ ...s, completed: s.required ? true : s.completed })) });
    expect(nextStep(done, 'questionnaire', new Set(['orientation']))).toBeNull();
    expect(missingRequired(state)).toEqual(['gender', 'questionnaire']);
    expect(missingRequired(done)).toEqual([]);
  });

  it('reports position and previous step', () => {
    expect(stepPosition(state, 'orientation')).toEqual({ index: 3, total: 4 });
    expect(previousStep(state, 'orientation')).toBe('gender');
    expect(previousStep(state, 'profile_basics')).toBeNull();
  });
});
