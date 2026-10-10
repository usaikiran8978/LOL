import { ageOn, isValidBirthDate } from './age';

describe('ageOn', () => {
  const at = (iso: string) => new Date(`${iso}T12:00:00Z`);

  it('is not yet 18 the day before the birthday', () => {
    expect(ageOn('2008-10-09', at('2026-10-08'))).toBe(17);
  });
  it('turns 18 on the birthday', () => {
    expect(ageOn('2008-10-08', at('2026-10-08'))).toBe(18);
  });
  it('handles Feb-29 birthdays in non-leap years', () => {
    expect(ageOn('2008-02-29', at('2026-02-28'))).toBe(17);
    expect(ageOn('2008-02-29', at('2026-03-01'))).toBe(18);
  });
});

describe('isValidBirthDate', () => {
  it('rejects impossible calendar dates', () => {
    expect(isValidBirthDate('2001-02-30')).toBe(false);
  });
  it('rejects future dates and absurd ages', () => {
    expect(isValidBirthDate('2999-01-01')).toBe(false);
    expect(isValidBirthDate('1800-01-01')).toBe(false);
  });
  it('accepts a normal date', () => {
    expect(isValidBirthDate('1995-06-15')).toBe(true);
  });
});
