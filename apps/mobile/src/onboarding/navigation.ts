import type { OnboardingState } from '../api/types';

/**
 * Pure step-navigation rules over the server's onboarding state (only applicable steps are returned by the API).
 * `skipped` holds optional steps the user chose to skip this session: the API has no "skip" for data-backed steps,
 * so without this the server's currentStep would keep pointing at them.
 */
export function nextStep(state: OnboardingState, after: string | null, skipped: ReadonlySet<string> = new Set()): string | null {
  const steps = state.steps;
  const start = after ? steps.findIndex((s) => s.key === after) + 1 : 0;
  for (let i = Math.max(0, start); i < steps.length; i++) {
    const s = steps[i]!;
    if (!s.completed && !skipped.has(s.key)) return s.key;
  }
  // Nothing left ahead: send the user back to any required step that is still missing.
  return steps.find((s) => s.required && !s.completed)?.key ?? null;
}

export function resumeStep(state: OnboardingState, skipped: ReadonlySet<string> = new Set()): string | null {
  if (state.completedAt) return null;
  const current = state.currentStep;
  if (current && state.steps.some((s) => s.key === current) && !skipped.has(current)) return current;
  return nextStep(state, null, skipped);
}

export function previousStep(state: OnboardingState, key: string): string | null {
  const i = state.steps.findIndex((s) => s.key === key);
  return i > 0 ? state.steps[i - 1]!.key : null;
}

export function stepPosition(state: OnboardingState, key: string): { index: number; total: number } {
  return { index: state.steps.findIndex((s) => s.key === key) + 1, total: state.steps.length };
}

export function missingRequired(state: OnboardingState): string[] {
  return state.steps.filter((s) => s.required && !s.completed).map((s) => s.key);
}
