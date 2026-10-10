import { en, type Messages } from './en';

/** Dotted paths to every string leaf of the resource file, e.g. `nav.items.audit`. */
type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

export type MessageKey = Leaves<Messages>;
export type MessageParams = Record<string, string | number>;

// Single active resource for now; the lookup goes through one function so adding locales is local to this file.
const active: Messages = en;

/** Active UI locale and its writing direction (the shell sets `<html lang dir>`; CSS uses logical properties). */
export const locale = 'en';
const RTL_LANGS = new Set(['ar', 'he', 'fa', 'ur']);
export const dir: 'ltr' | 'rtl' = RTL_LANGS.has(locale.split('-')[0]!) ? 'rtl' : 'ltr';

function lookup(key: string): string | undefined {
  let node: unknown = active;
  for (const part of key.split('.')) {
    if (node && typeof node === 'object') node = (node as Record<string, unknown>)[part];
    else return undefined;
  }
  return typeof node === 'string' ? node : undefined;
}

export function t(key: MessageKey, params?: MessageParams): string {
  const template = lookup(key) ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}

/** For keys built at runtime (e.g. enum values); falls back to the raw value when no translation exists. */
export function tDynamic(key: string, fallback: string, params?: MessageParams): string {
  return lookup(key) === undefined ? fallback : t(key as MessageKey, params);
}
