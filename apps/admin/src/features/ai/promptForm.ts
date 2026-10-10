import { adminAiPromptVersion } from '@amora/shared';
import type { z } from 'zod';
import { t } from '@/i18n';
import { parseJsonText, parseList, validate, type FieldErrors } from '@/lib/forms/validate';
import type { AiPromptVersion } from '@/lib/api/modules/ai';
import { toNumber } from './shared';

export interface PromptForm {
  systemPrompt: string;
  userTemplate: string;
  inputVariables: string;
  outputSchema: string;
  temperature: number | undefined;
  maxOutputTokens: number | undefined;
  changeNote: string;
}

const VAR_RE = /^[a-zA-Z_][a-zA-Z0-9_]{0,40}$/;
/** Same placeholder syntax the API checks (apps/api/src/modules/ai/ai.controller.ts createPromptVersion). */
const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

export function templateVariables(template: string): string[] {
  return [...new Set([...template.matchAll(PLACEHOLDER_RE)].map((m) => m[1]!))];
}

function schemaText(schema: unknown): string {
  if (typeof schema === 'string') {
    const parsed = parseJsonText(schema);
    return parsed.ok ? JSON.stringify(parsed.value, null, 2) : schema;
  }
  return JSON.stringify(schema ?? { type: 'object' }, null, 2);
}

export function promptFormFrom(v: AiPromptVersion | undefined): PromptForm {
  if (!v) return { systemPrompt: '', userTemplate: '', inputVariables: '', outputSchema: '{\n  "type": "object"\n}', temperature: undefined, maxOutputTokens: undefined, changeNote: '' };
  return {
    systemPrompt: v.system_prompt, userTemplate: v.user_template, inputVariables: v.input_variables.join(', '), outputSchema: schemaText(v.output_schema),
    temperature: toNumber(v.temperature) ?? undefined, maxOutputTokens: v.max_output_tokens ?? undefined, changeNote: '',
  };
}

export type PromptBody = z.output<typeof adminAiPromptVersion>;

/**
 * Client-side checks mirroring the API: shared zod contract, JSON parse of the schema, variable names, and every
 * {{placeholder}} declared. (The API additionally compiles the schema with Ajv; its error is shown from the response.)
 */
export function validatePromptForm(form: PromptForm): { ok: true; data: PromptBody } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const vars = parseList(form.inputVariables);
  const badVar = vars.find((v) => !VAR_RE.test(v));
  if (badVar) errors.inputVariables = t('ai.prompts.invalidVariable', { name: badVar });

  let outputSchema: unknown = undefined;
  const parsed = parseJsonText(form.outputSchema);
  if (!parsed.ok) errors.outputSchema = t('validation.invalidJson');
  else if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) errors.outputSchema = t('ai.prompts.schemaNotObject');
  else outputSchema = parsed.value;

  const undeclared = templateVariables(form.userTemplate).filter((u) => !vars.includes(u));
  if (undeclared.length) errors.userTemplate = t('ai.prompts.undeclared', { names: undeclared.join(', ') });

  const v = validate(adminAiPromptVersion, {
    systemPrompt: form.systemPrompt, userTemplate: form.userTemplate, outputSchema: outputSchema ?? {}, inputVariables: vars,
    temperature: form.temperature ?? null, maxOutputTokens: form.maxOutputTokens ?? null, changeNote: form.changeNote.trim() || undefined,
  });
  if (!v.ok) {
    for (const [path, msg] of Object.entries(v.errors)) {
      const field = path.split('.')[0]!;
      errors[field] ??= msg;
    }
  }
  if (!v.ok || Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, data: v.data };
}
