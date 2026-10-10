/** Whole years between an ISO birth date and `on` (UTC calendar arithmetic, like the API's ageOn). */
export function ageOn(isoDob: string, on: Date = new Date()): number {
  const [y, m, d] = isoDob.split('-').map(Number) as [number, number, number];
  let age = on.getUTCFullYear() - y;
  const beforeBirthday = on.getUTCMonth() + 1 < m || (on.getUTCMonth() + 1 === m && on.getUTCDate() < d);
  if (beforeBirthday) age -= 1;
  return age;
}

/** Client-side floor only (DEC-006 default). The authoritative per-country minimum is enforced by the server. */
export const DEFAULT_MIN_AGE = 18;
