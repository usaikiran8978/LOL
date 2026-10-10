import { createHmac } from 'node:crypto';
import { verifyStripeSignature } from './stripe';

describe('verifyStripeSignature', () => {
  const secret = 'whsec_test';
  const body = Buffer.from('{"id":"evt_1"}');
  const sign = (t: number, b = body) => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${b.toString()}`).digest('hex')}`;
  const now = 1_800_000_000_000;

  it('accepts a valid signature within tolerance', () => {
    expect(verifyStripeSignature(body, sign(now / 1000), secret, 300, now)).toBe(true);
  });
  it('rejects tampered bodies, wrong secrets and stale timestamps', () => {
    expect(verifyStripeSignature(Buffer.from('{"id":"evt_2"}'), sign(now / 1000), secret, 300, now)).toBe(false);
    expect(verifyStripeSignature(body, sign(now / 1000), 'whsec_other', 300, now)).toBe(false);
    expect(verifyStripeSignature(body, sign(now / 1000 - 1000), secret, 300, now)).toBe(false);
    expect(verifyStripeSignature(body, undefined, secret, 300, now)).toBe(false);
  });
});
