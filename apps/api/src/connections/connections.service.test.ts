import { describe, expect, it } from 'vitest';
import type { Connection } from '@prisma/client';
import { toConnectionDto } from './connections.service';

function buildConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn-1',
    userId: 'user-1',
    name: 'Demo',
    host: 'localhost',
    port: 5434,
    database: 'demo',
    engine: 'postgres',
    username: 'demo',
    encryptedCredentials: { iv: 'iv', tag: 'tag', data: 'data' },
    sslEnabled: false,
    sslRejectUnauthorized: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  };
}

describe('toConnectionDto', () => {
  it('maps a Connection row to a ConnectionDto', () => {
    const dto = toConnectionDto(buildConnection());

    expect(dto).toEqual({
      id: 'conn-1',
      name: 'Demo',
      host: 'localhost',
      port: 5434,
      database: 'demo',
      username: 'demo',
      sslEnabled: false,
      sslRejectUnauthorized: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
  });

  it('never includes the password or encrypted credentials', () => {
    const dto = toConnectionDto(buildConnection()) as unknown as Record<string, unknown>;

    expect(dto).not.toHaveProperty('password');
    expect(dto).not.toHaveProperty('encryptedCredentials');
    expect(dto).not.toHaveProperty('userId');
    expect(JSON.stringify(dto)).not.toContain('encryptedCredentials');
  });
});
