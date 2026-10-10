import type { ComponentType } from 'react';
import { AttributesEditor, ATTRIBUTE_GROUPS } from '../features/profile/AttributesEditor';
import { IdentityTermEditor } from '../features/profile/IdentityTermEditor';
import { InterestsEditor } from '../features/profile/InterestsEditor';
import { LanguagesEditor } from '../features/profile/LanguagesEditor';
import type { EditorProps } from '../features/profile/LoadState';
import { LocationEditor } from '../features/profile/LocationEditor';
import { MediaManager } from '../features/profile/MediaManager';
import { PreferencesEditor } from '../features/profile/PreferencesEditor';
import { ProfileBasicsForm } from '../features/profile/ProfileBasicsForm';
import { PromptsEditor } from '../features/profile/PromptsEditor';
import { GenericAckStep, PermissionsStep, QuestionnaireStep, VerificationStep } from './steps/AckSteps';

export interface StepComponentProps extends EditorProps {
  stepKey: string;
  required: boolean;
}

export interface StepDefinition {
  key: string;
  /** i18n keys; unknown steps use the generic copy. */
  titleKey: string;
  bodyKey: string;
  Component: ComponentType<StepComponentProps>;
  known: boolean;
}

const identity = (kind: 'gender' | 'orientation' | 'dating_intent' | 'relationship_goal') => (p: StepComponentProps) => <IdentityTermEditor {...p} kind={kind} />;
const attributes = (group: 'lifestyle' | 'family' | 'values' | 'communication_style') => (p: StepComponentProps) => <AttributesEditor {...p} group={group} kinds={ATTRIBUTE_GROUPS[group]} />;

/**
 * Step key → screen. Steps (order, required, conditions) are admin-defined on the server; the app only knows how to
 * render each key. Keep in sync with the step checks in apps/api/src/modules/profiles/onboarding.service.ts.
 */
const COMPONENTS: Record<string, ComponentType<StepComponentProps>> = {
  profile_basics: (p) => <ProfileBasicsForm {...p} />,
  location: (p) => <LocationEditor {...p} />,
  gender: identity('gender'),
  orientation: identity('orientation'),
  dating_intent: identity('dating_intent'),
  relationship_goal: identity('relationship_goal'),
  preferences: (p) => <PreferencesEditor {...p} requireGender />,
  interests: (p) => <InterestsEditor {...p} />,
  lifestyle: attributes('lifestyle'),
  family: attributes('family'),
  values: attributes('values'),
  communication_style: attributes('communication_style'),
  languages: (p) => <LanguagesEditor {...p} />,
  photos: (p) => <MediaManager {...p} />,
  prompts: (p) => <PromptsEditor {...p} />,
  questionnaire: QuestionnaireStep,
  permissions: PermissionsStep,
  verification: VerificationStep,
};

export const KNOWN_STEP_KEYS = Object.keys(COMPONENTS);

export function resolveStep(key: string): StepDefinition {
  const Component = COMPONENTS[key];
  if (Component) return { key, titleKey: `onboarding.steps.${key}.title`, bodyKey: `onboarding.steps.${key}.body`, Component, known: true };
  return { key, titleKey: 'onboarding.steps.generic.title', bodyKey: 'onboarding.steps.generic.intro', Component: GenericAckStep, known: false };
}
