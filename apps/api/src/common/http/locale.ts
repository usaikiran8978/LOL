import type { Request } from 'express';

const LOCALE = /^[a-z]{2,3}(-[A-Z]{2})?$/;

/** Locale for localized content: ?locale= wins, then the first Accept-Language tag, then English. */
export function requestLocale(req: Request): string {
  const q = typeof req.query.locale === 'string' ? req.query.locale : undefined;
  if (q && LOCALE.test(q)) return q;
  const header = req.header('accept-language')?.split(',')[0]?.split(';')[0]?.trim();
  if (header) {
    const [lang, region] = header.split('-');
    const normalized = region ? `${lang!.toLowerCase()}-${region.toUpperCase()}` : lang!.toLowerCase();
    if (LOCALE.test(normalized)) return normalized;
  }
  return 'en';
}
