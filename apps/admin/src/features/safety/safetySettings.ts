import { z } from 'zod';
import type { SettingValueType } from '@/lib/api/admin-api';

/*
 * System settings read by the safety services (apps/api/src/modules/safety/*.service.ts via SettingsService.get).
 * There is no dedicated safety-settings endpoint: they are read/written through /admin/config/settings, which
 * requires `settings.manage`. Defaults mirror the service fallbacks.
 */

export const SLA_DEFAULT = { critical: 1, high: 4, medium: 24, low: 72 };
export const IMAGE_POLICY_DEFAULT = {
  rejectLabels: ['Explicit Nudity', 'Explicit', 'Violence', 'Visually Disturbing', 'Hate Symbols', 'Drugs & Tobacco Paraphernalia & Use'],
  reviewLabels: ['Suggestive', 'Non-Explicit Nudity of Intimate parts and Kissing', 'Swimwear or Underwear', 'Alcohol', 'Gambling', 'Rude Gestures'],
  rejectConfidence: 0.9,
  reviewConfidence: 0.6,
};

const hours = z.number().positive().max(24 * 365);
export const slaSchema = z.object({ critical: hours, high: hours, medium: hours, low: hours });
const labels = z.array(z.string().trim().min(1).max(200)).max(200);
/** ImagePolicy (image-moderation.ts). The review threshold must not exceed the reject threshold (checked in the form). */
export const imagePolicySchema = z.object({ rejectLabels: labels, reviewLabels: labels, rejectConfidence: z.number().min(0).max(1), reviewConfidence: z.number().min(0).max(1) });
export const oncallSchema = z.union([z.literal(''), z.email().max(254)]);
export const validDaysSchema = z.number().int().min(1).max(3650);

export type SafetySettingKind = 'sla' | 'imagePolicy' | 'boolean' | 'email' | 'days';

export interface SafetySetting {
  key: string;
  id: 'slaHours' | 'mediaAutoApprove' | 'imagePolicy' | 'oncallEmail' | 'validDays';
  kind: SafetySettingKind;
  valueType: SettingValueType;
  fallback: unknown;
}

export const SAFETY_SETTINGS: SafetySetting[] = [
  { key: 'moderation.sla_hours', id: 'slaHours', kind: 'sla', valueType: 'json', fallback: SLA_DEFAULT },
  { key: 'moderation.media_auto_approve', id: 'mediaAutoApprove', kind: 'boolean', valueType: 'boolean', fallback: false },
  { key: 'moderation.image_policy', id: 'imagePolicy', kind: 'imagePolicy', valueType: 'json', fallback: IMAGE_POLICY_DEFAULT },
  { key: 'moderation.oncall_email', id: 'oncallEmail', kind: 'email', valueType: 'string', fallback: '' },
  { key: 'verification.valid_days', id: 'validDays', kind: 'days', valueType: 'number', fallback: 365 },
];
