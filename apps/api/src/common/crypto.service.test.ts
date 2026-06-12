import { describe, expect, it } from 'vitest';
import { randomBytes } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { CryptoService } from './crypto.service';

function createCryptoService(): CryptoService {
  const key = randomBytes(32).toString('base64');
  return new CryptoService(new ConfigService({ CREDENTIAL_ENCRYPTION_KEY: key }));
}

describe('CryptoService', () => {
  it('round-trips plaintext through encrypt and decrypt', () => {
    const crypto = createCryptoService();
    const plaintext = 'super-secret-password';

    const payload = crypto.encrypt(plaintext);

    expect(crypto.decrypt(payload)).toBe(plaintext);
  });

  it('uses a fresh IV for each encryption', () => {
    const crypto = createCryptoService();

    const a = crypto.encrypt('same-input');
    const b = crypto.encrypt('same-input');

    expect(a.iv).not.toBe(b.iv);
    expect(a.data).not.toBe(b.data);
  });

  it('rejects a tampered auth tag', () => {
    const crypto = createCryptoService();
    const payload = crypto.encrypt('tamper-test');

    const tampered = { ...payload, tag: randomBytes(16).toString('base64') };

    expect(() => crypto.decrypt(tampered)).toThrow();
  });

  it('rejects a key that is not 32 bytes', () => {
    const shortKey = randomBytes(16).toString('base64');

    expect(() => new CryptoService(new ConfigService({ CREDENTIAL_ENCRYPTION_KEY: shortKey }))).toThrow(
      'CREDENTIAL_ENCRYPTION_KEY must decode to exactly 32 bytes',
    );
  });
});
