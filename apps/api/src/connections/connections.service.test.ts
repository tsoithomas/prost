import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Connection } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { CryptoService, EncryptedPayload } from '../common/crypto.service';
import type { DbDriver } from '../database/db-driver.interface';
import type { DbDriverRegistry } from '../database/db-driver.registry';
import type { PoolManager } from '../database/pool-manager.service';
import type { PrismaService } from '../prisma/prisma.service';
import { ConnectionsService, toConnectionDto } from './connections.service';

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

const CAPS = { hasSchemas: true, readOnly: false };
const ENCRYPTED: EncryptedPayload = { iv: 'iv', tag: 'tag', data: 'data' };

function createService(storedConnection: Connection = buildConnection()) {
  const connection = {
    findMany: vi.fn().mockResolvedValue([]),
    findUnique: vi.fn().mockResolvedValue(storedConnection),
    create: vi.fn().mockImplementation(({ data }) => Promise.resolve(buildConnection(data))),
    update: vi.fn().mockImplementation(({ data }) => Promise.resolve(buildConnection(data))),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  const prisma = { connection } as unknown as PrismaService;
  const crypto = {
    encrypt: vi.fn().mockReturnValue(ENCRYPTED),
    decrypt: vi.fn().mockReturnValue('stored-password'),
  } as unknown as CryptoService;
  const poolManager = {
    testConnection: vi.fn().mockResolvedValue({ ok: true, message: 'Connection successful' }),
    evictPool: vi.fn().mockResolvedValue(undefined),
  } as unknown as PoolManager;
  const registry = {
    get: vi.fn().mockImplementation((engine: string) => {
      if (engine === 'postgres' || engine === 'mysql' || engine === 'sqlite') {
        return { capabilities: { supportsSchemas: true } } as DbDriver;
      }
      throw new BadRequestException(`Unsupported database engine "${engine}"`);
    }),
  } as unknown as DbDriverRegistry;
  const config = { getOrThrow: vi.fn() } as unknown as ConfigService;

  return { service: new ConnectionsService(prisma, crypto, poolManager, registry, config), connection, poolManager };
}

describe('toConnectionDto', () => {
  it('maps a Connection row to a ConnectionDto', () => {
    const dto = toConnectionDto(buildConnection(), CAPS);

    expect(dto).toEqual({
      id: 'conn-1',
      name: 'Demo',
      engine: 'postgres',
      host: 'localhost',
      port: 5434,
      database: 'demo',
      username: 'demo',
      sslEnabled: false,
      sslRejectUnauthorized: true,
      capabilities: { hasSchemas: true, readOnly: false },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
  });

  it('never includes the password or encrypted credentials', () => {
    const dto = toConnectionDto(buildConnection(), CAPS) as unknown as Record<string, unknown>;

    expect(dto).not.toHaveProperty('password');
    expect(dto).not.toHaveProperty('encryptedCredentials');
    expect(dto).not.toHaveProperty('userId');
    expect(JSON.stringify(dto)).not.toContain('encryptedCredentials');
  });
});

describe('ConnectionsService', () => {
  const validFields = {
    name: 'My database',
    host: 'localhost',
    port: 3306,
    database: 'app',
    username: 'app',
    password: 'secret',
    sslEnabled: false,
    sslRejectUnauthorized: true,
  };

  const validUnsavedFields = {
    host: 'localhost',
    port: 3306,
    database: 'app',
    username: 'app',
    password: 'secret',
    sslEnabled: false,
    sslRejectUnauthorized: true,
  };

  it('creates a MySQL connection when the registry supports it', async () => {
    const { service, connection } = createService();

    await service.create('user-1', { ...validFields, engine: 'mysql' });

    expect(connection.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ engine: 'mysql' }),
    });
  });

  it('tests an unsaved MySQL connection when the registry supports it', async () => {
    const { service, poolManager } = createService();

    await service.test('user-1', { ...validUnsavedFields, engine: 'mysql' });

    expect(poolManager.testConnection).toHaveBeenCalledWith('mysql', expect.objectContaining(validUnsavedFields));
  });

  it('rejects an unknown engine before persistence', async () => {
    const { service, connection } = createService();

    await expect(
      service.create('user-1', {
        ...validFields,
        engine: 'oracle',
      } as unknown as Parameters<ConnectionsService['create']>[1]),
    ).rejects.toThrow(BadRequestException);
    expect(connection.create).not.toHaveBeenCalled();
  });

  it('does not write engine during update', async () => {
    const { service, connection } = createService();

    await service.update('user-1', 'conn-1', {
      name: 'Renamed',
      engine: 'mysql',
    } as unknown as Parameters<ConnectionsService['update']>[2]);

    const data = connection.update.mock.calls[0]![0].data;
    expect(data).not.toHaveProperty('engine');
  });

  it('uses the stored engine when testing a saved connection', async () => {
    const { service, poolManager } = createService(buildConnection({ engine: 'postgres' }));

    await service.test('user-1', { id: 'conn-1', engine: 'mysql', password: 'x' });

    expect(poolManager.testConnection).toHaveBeenCalledWith('postgres', expect.any(Object));
  });
});
