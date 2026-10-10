import { randomBytes } from 'node:crypto';
import { FieldEncryption, parseRetiredKeys } from './field-encryption';

describe('FieldEncryption', () => {
  const enc = new FieldEncryption(randomBytes(32).toString('base64'));

  it('round-trips', () => {
    expect(enc.decrypt(enc.encrypt('+14155550123'))).toBe('+14155550123');
  });

  it('uses a fresh IV per encryption', () => {
    expect(enc.encrypt('x').equals(enc.encrypt('x'))).toBe(false);
  });

  it('detects tampering', () => {
    const blob = enc.encrypt('secret');
    blob[blob.length - 1]! ^= 0xff;
    expect(() => enc.decrypt(blob)).toThrow();
  });

  it('decrypts with retired keys after rotation and flags rows for re-encryption', () => {
    const k1 = randomBytes(32).toString('base64');
    const old = new FieldEncryption(k1, 1);
    const blob = old.encrypt('JBSWY3DPEHPK3PXP');
    const rotated = new FieldEncryption(randomBytes(32).toString('base64'), 2, parseRetiredKeys([`1:${k1}`]));
    expect(rotated.decrypt(blob)).toBe('JBSWY3DPEHPK3PXP');
    expect(rotated.needsRotation(blob)).toBe(true);
    const fresh = rotated.encrypt('JBSWY3DPEHPK3PXP');
    expect(fresh[0]).toBe(2);
    expect(rotated.needsRotation(fresh)).toBe(false);
    expect(() => old.decrypt(fresh)).toThrow(/no key for ciphertext version 2/);
  });

  it('rejects malformed rotation config', () => {
    expect(() => parseRetiredKeys(['nope'])).toThrow();
    const k = randomBytes(32).toString('base64');
    expect(() => new FieldEncryption(k, 1, { 1: k })).toThrow(/collides/);
  });

  it('rejects short keys', () => {
    expect(() => new FieldEncryption(randomBytes(16).toString('base64'))).toThrow();
  });
});
