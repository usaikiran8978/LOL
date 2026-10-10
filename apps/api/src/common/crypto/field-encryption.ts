import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** Every table/column holding FieldEncryption ciphertext; the rotation script re-encrypts exactly these. */
export const ENCRYPTED_COLUMNS = [
  { table: 'trusted_contacts', id: 'id', column: 'phone_e164_enc' },
  { table: 'trusted_contacts', id: 'id', column: 'email_enc' },
  { table: 'admin_users', id: 'id', column: 'mfa_secret_enc' },
] as const;

function parseKey(base64Key: string, label: string): Buffer {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== 32) throw new Error(`${label} must be 32 bytes (base64)`);
  return key;
}

/**
 * AES-256-GCM application-level encryption for sensitive columns (MFA seeds, trusted-contact details).
 * Layout: [keyVersion:1][iv:12][tag:16][ciphertext]. The leading byte names the key, so keys can be rotated:
 * new data is written with the current key while retired keys (FIELD_ENCRYPTION_RETIRED_KEYS) still decrypt old rows
 * until `npm run db:rotate-encryption` has re-encrypted them (docs/runbooks/incident-response.md).
 */
export class FieldEncryption {
  private readonly keys = new Map<number, Buffer>();

  constructor(base64Key: string, readonly currentVersion = 1, retired: Record<number, string> = {}) {
    if (!Number.isInteger(currentVersion) || currentVersion < 1 || currentVersion > 255) throw new Error('FIELD_ENCRYPTION_KEY_VERSION must be 1..255');
    for (const [v, k] of Object.entries(retired)) {
      if (Number(v) === currentVersion) throw new Error(`retired key ${v} collides with the current key version`);
      this.keys.set(Number(v), parseKey(k, `FIELD_ENCRYPTION_RETIRED_KEYS[${v}]`));
    }
    this.keys.set(currentVersion, parseKey(base64Key, 'FIELD_ENCRYPTION_KEY'));
  }

  encrypt(plaintext: string): Buffer {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.keys.get(this.currentVersion)!, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return Buffer.concat([Buffer.from([this.currentVersion]), iv, cipher.getAuthTag(), ct]);
  }

  decrypt(blob: Buffer): string {
    const key = this.keys.get(blob[0]!);
    if (!key) throw new Error(`no key for ciphertext version ${blob[0]}`);
    const decipher = createDecipheriv('aes-256-gcm', key, blob.subarray(1, 13));
    decipher.setAuthTag(blob.subarray(13, 29));
    return Buffer.concat([decipher.update(blob.subarray(29)), decipher.final()]).toString('utf8');
  }

  needsRotation(blob: Buffer): boolean {
    return blob[0] !== this.currentVersion;
  }
}

/** Parses "1:base64,2:base64" into { 1: 'base64', 2: 'base64' }. */
export function parseRetiredKeys(list: string[]): Record<number, string> {
  return Object.fromEntries(list.map((entry) => {
    const i = entry.indexOf(':');
    const v = Number(entry.slice(0, i));
    if (i < 1 || !Number.isInteger(v) || v < 1 || v > 255) throw new Error('FIELD_ENCRYPTION_RETIRED_KEYS entries must look like "<version>:<base64 key>"');
    return [v, entry.slice(i + 1)];
  }));
}

export const FIELD_ENCRYPTION = Symbol('FIELD_ENCRYPTION');
