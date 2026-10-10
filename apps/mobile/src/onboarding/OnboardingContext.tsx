import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { onboardingApi, type OnboardingState } from '../api';
import { useResource, type Resource } from '../hooks/useResource';
import { nextStep } from './navigation';

interface OnboardingContextValue {
  resource: Resource<OnboardingState>;
  skipped: ReadonlySet<string>;
  /** Marks the step complete on the server and returns the key to show next (null → completion screen). */
  completeStep: (key: string) => Promise<string | null>;
  skipStep: (key: string) => string | null;
  saveDraft: (key: string, draft: Record<string, unknown>) => Promise<void>;
  setState: (s: OnboardingState) => void;
}

const Ctx = createContext<OnboardingContextValue | null>(null);

export function useOnboarding(): OnboardingContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useOnboarding outside OnboardingProvider');
  return v;
}

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const resource = useResource(onboardingApi.get);
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set());
  const { data, setData } = resource;

  const completeStep = useCallback(
    async (key: string) => {
      const next = await onboardingApi.saveStep({ step: key, complete: true });
      setData(next);
      return nextStep(next, key, skipped);
    },
    [setData, skipped],
  );

  const skipStep = useCallback(
    (key: string) => {
      const s = new Set(skipped).add(key);
      setSkipped(s);
      return data ? nextStep(data, key, s) : null;
    },
    [data, skipped],
  );

  const saveDraft = useCallback(
    async (key: string, draft: Record<string, unknown>) => {
      setData(await onboardingApi.saveStep({ step: key, draft: { ...draft, step: key }, complete: false }));
    },
    [setData],
  );

  const value = useMemo(() => ({ resource, skipped, completeStep, skipStep, saveDraft, setState: setData }), [resource, skipped, completeStep, skipStep, saveDraft, setData]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
