import { describe, expect, it } from 'vitest';
import { parseConnectionString } from './parseConnectionString.js';

describe('parseConnectionString', () => {
  it('parses a full connection string', () => {
    const result = parseConnectionString('postgres://user:pass@host:5433/mydb?sslmode=require');
    expect(result).toEqual({
      ok: true,
      value: {
        host: 'host',
        port: 5433,
        database: 'mydb',
        username: 'user',
        password: 'pass',
        sslEnabled: true,
        sslRejectUnauthorized: false,
      },
    });
  });

  it('defaults password to an empty string when absent', () => {
    const result = parseConnectionString('postgres://admin@host/db');
    expect(result).toEqual({
      ok: true,
      value: {
        host: 'host',
        port: 5432,
        database: 'db',
        username: 'admin',
        password: '',
        sslEnabled: true,
        sslRejectUnauthorized: false,
      },
    });
  });

  it('defaults port to 5432 when absent', () => {
    const result = parseConnectionString('postgres://user:pass@host/db');
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.port).toBe(5432);
  });

  it('percent-decodes the username and password', () => {
    const result = parseConnectionString('postgres://us%40er:p%40ss@host:5432/db');
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.username).toBe('us@er');
    expect(result.ok && result.value.password).toBe('p@ss');
  });

  it.each([
    ['require', true],
    ['verify-ca', true],
    ['verify-full', true],
    ['prefer', true],
    ['disable', false],
    ['allow', false],
  ])('maps sslmode=%s to sslEnabled=%s', (sslmode, expected) => {
    const result = parseConnectionString(`postgres://user:pass@host:5432/db?sslmode=${sslmode}`);
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.sslEnabled).toBe(expected);
  });

  it('defaults sslEnabled to true when sslmode is absent', () => {
    const result = parseConnectionString('postgres://user:pass@host:5432/db');
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.sslEnabled).toBe(true);
  });

  it.each([
    ['verify-ca', true],
    ['verify-full', true],
    ['require', false],
    ['prefer', false],
  ])('maps sslmode=%s to sslRejectUnauthorized=%s', (sslmode, expected) => {
    const result = parseConnectionString(`postgres://user:pass@host:5432/db?sslmode=${sslmode}`);
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.sslRejectUnauthorized).toBe(expected);
  });

  it('defaults sslRejectUnauthorized to false when sslmode is absent', () => {
    const result = parseConnectionString('postgres://user:pass@host:5432/db');
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.sslRejectUnauthorized).toBe(false);
  });

  it('treats postgresql:// the same as postgres://', () => {
    const result = parseConnectionString('postgresql://user:pass@host:5432/db');
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.host).toBe('host');
  });

  it('leaves database blank (not an error) when no path is present', () => {
    const result = parseConnectionString('postgres://user:pass@host:5432');
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.database).toBe('');
  });

  it('rejects a connection string with no host', () => {
    const result = parseConnectionString('postgres://');
    expect(result).toEqual({
      ok: false,
      error: 'Connection string is missing a host.',
    });
  });

  it('rejects a non-Postgres scheme without throwing', () => {
    const result = parseConnectionString('mysql://user:pass@host:3306/db');
    expect(result).toEqual({
      ok: false,
      error: 'Connection string must start with postgres:// or postgresql://',
    });
  });

  it.each(['', '   ', 'not a url', 'http://'])('rejects garbage input %j without throwing', (input) => {
    const result = parseConnectionString(input);
    expect(result.ok).toBe(false);
  });
});
