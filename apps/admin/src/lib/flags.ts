import { adminFlagUpsert } from '@amora/shared';
import type { z } from 'zod';
import { t } from '@/i18n';
import type { FlagRow, FlagRuleType } from './api/admin-api';
import { parseList, validate, type FieldErrors } from './forms/validate';

export const RULE_TYPES: FlagRuleType[] = ['country', 'percentage', 'segment', 'user', 'platform', 'app_version'];
export const PLATFORMS = ['ios', 'android', 'web'] as const;
export type FlagPlatform = (typeof PLATFORMS)[number];

/** Editable rule: list targets kept as text while typing; only the target matching `ruleType` is sent. */
export interface RuleForm {
  id: string;
  ruleType: FlagRuleType;
  countryCodes: string;
  percentage: number | undefined;
  segmentKey: string;
  userIds: string;
  platforms: FlagPlatform[];
  minAppVersion: string;
  value: boolean;
}

export interface FlagForm {
  key: string;
  description: string;
  enabled: boolean;
  defaultValue: boolean;
  rules: RuleForm[];
}

let seq = 0;
export function newRule(ruleType: FlagRuleType = 'country'): RuleForm {
  return { id: `r${++seq}`, ruleType, countryCodes: '', percentage: undefined, segmentKey: '', userIds: '', platforms: [], minAppVersion: '', value: true };
}

export function flagToForm(flag: FlagRow): FlagForm {
  return {
    key: flag.key,
    description: flag.description ?? '',
    enabled: flag.enabled,
    defaultValue: flag.default_value,
    rules: [...flag.rules]
      .sort((a, b) => a.priority - b.priority)
      .map((r) => ({
        ...newRule(r.rule_type),
        countryCodes: (r.country_codes ?? []).join(', '),
        percentage: r.percentage ?? undefined,
        segmentKey: r.segment_key ?? '',
        userIds: (r.user_ids ?? []).join('\n'),
        platforms: r.platforms ?? [],
        minAppVersion: r.min_app_version ?? '',
        value: r.value,
      })),
  };
}

export type FlagPayload = z.input<typeof adminFlagUpsert>;

export function formToPayload(form: FlagForm): FlagPayload {
  return {
    key: form.key.trim(),
    description: form.description.trim() || undefined,
    enabled: form.enabled,
    defaultValue: form.defaultValue,
    // Array order is the priority the API stores (index 0 = evaluated first).
    rules: form.rules.map((r) => {
      const base = { ruleType: r.ruleType, value: r.value };
      switch (r.ruleType) {
        case 'country': return { ...base, countryCodes: parseList(r.countryCodes).map((c) => c.toUpperCase()) };
        case 'percentage': return { ...base, percentage: r.percentage };
        case 'segment': return { ...base, segmentKey: r.segmentKey || undefined };
        case 'user': return { ...base, userIds: parseList(r.userIds) };
        case 'platform': return { ...base, platforms: r.platforms };
        case 'app_version': return { ...base, minAppVersion: r.minAppVersion.trim() || undefined };
      }
    }),
  };
}

const TARGET_FIELD: Record<FlagRuleType, string> = {
  country: 'countryCodes', percentage: 'percentage', segment: 'segmentKey', user: 'userIds', platform: 'platforms', app_version: 'minAppVersion',
};

/**
 * Shared zod contract plus the API's extra rule check ("rule of type X is missing its target"), so the
 * admin sees the problem on the right rule before the request is made.
 */
export function validateFlagForm(form: FlagForm): { ok: true; data: z.output<typeof adminFlagUpsert> } | { ok: false; errors: FieldErrors } {
  const payload = formToPayload(form);
  const result = validate(adminFlagUpsert, payload);
  const errors: FieldErrors = result.ok ? {} : { ...result.errors };
  payload.rules?.forEach((r, i) => {
    const present = {
      country: !!r.countryCodes?.length, percentage: r.percentage !== undefined, segment: !!r.segmentKey, user: !!r.userIds?.length,
      platform: !!r.platforms?.length, app_version: !!r.minAppVersion,
    }[r.ruleType];
    const path = `rules.${i}.${TARGET_FIELD[r.ruleType]}`;
    if (!present && !Object.keys(errors).some((k) => k.startsWith(path))) errors[path] = t('validation.ruleTarget', { type: t(`flags.types.${r.ruleType}`) });
  });
  // Re-key nested array element errors (rules.0.countryCodes.1) to the rule's field.
  for (const k of Object.keys(errors)) {
    const m = /^(rules\.\d+\.[A-Za-z]+)\.\d+$/.exec(k);
    if (m && !errors[m[1]!]) errors[m[1]!] = errors[k]!;
  }
  if (Object.keys(errors).length || !result.ok) return { ok: false, errors };
  return { ok: true, data: result.data };
}
