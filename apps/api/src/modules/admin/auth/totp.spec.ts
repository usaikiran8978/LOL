import { base32Decode, totp, verifyTotp } from './totp';

// RFC 6238 Appendix B test vector (SHA-1 secret "12345678901234567890"), truncated to 6 digits.
const secret = Buffer.from('12345678901234567890');

describe('totp', () => {
  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ])('matches RFC 6238 vector at t=%i', (t, expected) => {
    expect(totp(secret, t * 1000)).toBe(expected);
  });

  it('tolerates one step of clock drift and no more', () => {
    const now = 1_700_000_000_000;
    expect(verifyTotp(secret, totp(secret, now - 30_000), now)).toBe(true);
    expect(verifyTotp(secret, totp(secret, now - 90_000), now)).toBe(false);
  });

  it('decodes base32', () => {
    expect(base32Decode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ').toString()).toBe('12345678901234567890');
  });
});
