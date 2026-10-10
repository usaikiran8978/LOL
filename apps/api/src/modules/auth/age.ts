/** Whole years between a YYYY-MM-DD birth date and `today` (UTC). Feb-29 birthdays turn a year older on Mar 1 in non-leap years. */
export function ageOn(dateOfBirth: string, today: Date = new Date()): number {
  const [y, m, d] = dateOfBirth.split('-').map(Number) as [number, number, number];
  const ty = today.getUTCFullYear();
  const tm = today.getUTCMonth() + 1;
  const td = today.getUTCDate();
  let age = ty - y;
  if (tm < m || (tm === m && td < d)) age -= 1;
  return age;
}

export function isValidBirthDate(dateOfBirth: string, today: Date = new Date()): boolean {
  const parsed = new Date(`${dateOfBirth}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== dateOfBirth) return false;
  const age = ageOn(dateOfBirth, today);
  return age >= 0 && age <= 120;
}
