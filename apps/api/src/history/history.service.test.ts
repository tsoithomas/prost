import { describe, expect, it, vi } from 'vitest';
import type { QueryHistory } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { HistoryService, toQueryHistoryDto } from './history.service';

function buildEntry(overrides: Partial<QueryHistory> = {}): QueryHistory {
  return {
    id: 'hist-1',
    userId: 'user-1',
    connectionId: 'conn-1',
    sql: 'SELECT * FROM users',
    executedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function createService(findMany = vi.fn().mockResolvedValue([]), create = vi.fn().mockResolvedValue(undefined)) {
  const prisma = { queryHistory: { findMany, create } } as unknown as PrismaService;
  return { service: new HistoryService(prisma), findMany, create };
}

describe('toQueryHistoryDto', () => {
  it('maps a QueryHistory row to a QueryHistoryDto', () => {
    const dto = toQueryHistoryDto(buildEntry());

    expect(dto).toEqual({
      id: 'hist-1',
      connectionId: 'conn-1',
      sql: 'SELECT * FROM users',
      executedAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('never includes the userId', () => {
    const dto = toQueryHistoryDto(buildEntry()) as Record<string, unknown>;

    expect(dto).not.toHaveProperty('userId');
  });
});

describe('HistoryService.listRecent', () => {
  it('queries by user and connection, newest first, capped at 50', async () => {
    const { service, findMany } = createService();

    await service.listRecent('user-1', 'conn-1');

    expect(findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', connectionId: 'conn-1' },
      orderBy: { executedAt: 'desc' },
      take: 50,
    });
  });

  it('collapses consecutive duplicate SQL', async () => {
    const findMany = vi.fn().mockResolvedValue([
      buildEntry({ id: 'a', sql: 'SELECT 1', executedAt: new Date('2026-01-03T00:00:00.000Z') }),
      buildEntry({ id: 'b', sql: 'SELECT 1', executedAt: new Date('2026-01-02T00:00:00.000Z') }),
      buildEntry({ id: 'c', sql: 'SELECT 2', executedAt: new Date('2026-01-01T00:00:00.000Z') }),
    ]);
    const { service } = createService(findMany);

    const result = await service.listRecent('user-1', 'conn-1');

    expect(result.map((entry) => entry.id)).toEqual(['a', 'c']);
  });
});

describe('HistoryService.record', () => {
  it('writes only userId, connectionId, and sql — never rows or bound values', async () => {
    const { service, create } = createService();

    await service.record({ userId: 'user-1', connectionId: 'conn-1', sql: 'SELECT 1' });

    expect(create).toHaveBeenCalledWith({ data: { userId: 'user-1', connectionId: 'conn-1', sql: 'SELECT 1' } });
  });

  it('swallows write failures so a history error never breaks query execution', async () => {
    const create = vi.fn().mockRejectedValue(new Error('db down'));
    const { service } = createService(undefined, create);

    await expect(
      service.record({ userId: 'user-1', connectionId: 'conn-1', sql: 'SELECT 1' }),
    ).resolves.toBeUndefined();
  });
});
