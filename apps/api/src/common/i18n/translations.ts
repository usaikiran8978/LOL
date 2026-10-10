/**
 * Locale fallback chain for admin-managed content: exact ('pt-BR') → language ('pt') → English.
 * Use with `pickTranslation(rows, locale)` after loading all candidate rows for an entity.
 */
export function localeChain(locale: string): string[] {
  const base = locale.split('-')[0]!;
  return [...new Set([locale, base, 'en'])];
}

export function pickTranslation<T extends { locale: string }>(rows: T[], locale: string): T | undefined {
  for (const l of localeChain(locale)) {
    const hit = rows.find((r) => r.locale === l);
    if (hit) return hit;
  }
  return rows[0];
}
