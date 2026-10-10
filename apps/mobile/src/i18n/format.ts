import i18n from './index';

// Formatting always goes through Intl with the active UI language so dates/numbers follow the user's locale
// (Arabic gets Arabic-Indic digits and RTL-appropriate ordering automatically).

export function formatDate(iso: string | Date | null | undefined, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }): string {
  if (!iso) return '';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat(i18n.language, opts).format(d);
}

export function formatDateTime(iso: string | Date | null | undefined): string {
  return formatDate(iso, { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatNumber(n: number, opts?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(i18n.language, opts).format(n);
}

export function formatPercent(n: number): string {
  return formatNumber(n / 100, { style: 'percent', maximumFractionDigits: 0 });
}

export function formatDistanceKm(km: number, measurement: 'metric' | 'imperial' = 'metric'): string {
  return measurement === 'imperial'
    ? formatNumber(Math.round(km * 0.621371), { style: 'unit', unit: 'mile', unitDisplay: 'short' })
    : formatNumber(km, { style: 'unit', unit: 'kilometer', unitDisplay: 'short' });
}

/** Localized language name from a BCP-47 code (falls back to the code itself). */
export function languageName(code: string): string {
  try {
    return new Intl.DisplayNames([i18n.language], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}
