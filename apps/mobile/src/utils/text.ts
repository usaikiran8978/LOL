/** Readable fallback for a server key that has no client translation yet ("love_languages" → "Love languages"). */
export function humanizeKey(key: string): string {
  const s = key.replace(/[._-]+/g, ' ').trim();
  return s ? s.charAt(0).toLocaleUpperCase() + s.slice(1) : key;
}
