import { describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { QueryHistory } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { HistoryService, toQueryHistoryDto } from './history.service';

type HistoryWithConnection = QueryHistory & { connection: { name: string } };

function buildEntry(overrides: Partial<HistoryWithConnection> = {}): HistoryWithConnection {
  return {
    id: 'hist-1',
    userId: 'user-1',
    connectionId: 'conn-1',
    sql: 'SELECT * FROM users',
    starred: false,
    label: null,
    executedAt: new Date('2026-01-01T00:00:00.000Z'),
    connection: { name: 'Local PG' },
    ...overrides,
  };
}

interface PrismaMocks {
  findMany?: ReturnType<typeof vi.fn>;
  findUnique?: ReturnType<typeof vi.fn>;
  create?: ReturnType<typeof vi.fn>;
  update?: ReturnType<typeof vi.fn>;
  delete?: ReturnType<typeof vi.fn>;
  deleteMany?: ReturnType<typeof vi.fn>;
}

function createService(mocks: PrismaMocks = {}) {
  const queryHistory = {
    findMany: mocks.findMany ?? vi.fn().mockResolvedValue([]),
    findUnique: mocks.findUnique ?? vi.fn().mockResolvedValue(null),
    create: mocks.create ?? vi.fn().mockResolvedValue(undefined),
    update: mocks.update ?? vi.fn().mockResolvedValue(buildEntry()),
    delete: mocks.delete ?? vi.fn().mockResolvedValue(undefined),
    deleteMany: mocks.deleteMany ?? vi.fn().mockResolvedValue({ count: 0 }),
  };
  const prisma = { queryHistory } as unknown as PrismaService;
  const config = { get: vi.fn().mockReturnValue(undefined) } as unknown as ConfigService;
  return { service: new HistoryService(prisma, config), queryHistory };
}

describe('toQueryHistoryDto', () => {
  it('maps a QueryHistory row (with its connection name) to a QueryHistoryDto', () => {
    const dto = toQueryHistoryDto(buildEntry({ starred: true, label: 'My query' }));

    expect(dto).toEqual({
      id: 'hist-1',
      connectionId: 'conn-1',
      connectionName: 'Local PG',
      sql: 'SELECT * FROM users',
      executedAt: '2026-01-01T00:00:00.000Z',
      starred: true,
      label: 'My query',
    });
  });

  it('omits label when null and never includes the userId', () => {
    const dto = toQueryHistoryDto(buildEntry()) as unknown as Record<string, unknown>;

    expect(dto).not.toHaveProperty('label');
    expect(dto).not.toHaveProperty('userId');
  });
});

describe('HistoryService.listRecent', () => {
  it('queries by user and connection, newest first, capped at 50', async () => {
    const { service, queryHistory } = createService();

    await service.listRecent('user-1', 'conn-1');

    expect(queryHistory.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', connectionId: 'conn-1' },
      orderBy: { executedAt: 'desc' },
      take: 50,
      include: { connection: { select: { name: true } } },
    });
  });

  it('collapses consecutive duplicate SQL', async () => {
    const findMany = vi.fn().mockResolvedValue([
      buildEntry({ id: 'a', sql: 'SELECT 1', executedAt: new Date('2026-01-03T00:00:00.000Z') }),
      buildEntry({ id: 'b', sql: 'SELECT 1', executedAt: new Date('2026-01-02T00:00:00.000Z') }),
      buildEntry({ id: 'c', sql: 'SELECT 2', executedAt: new Date('2026-01-01T00:00:00.000Z') }),
    ]);
    const { service } = createService({ findMany });

    const result = await service.listRecent('user-1', 'conn-1');

    expect(result.map((entry) => entry.id)).toEqual(['a', 'c']);
  });
});

describe('HistoryService.record', () => {
  it('writes only userId, connectionId, and sql — never rows or bound values', async () => {
    const { service, queryHistory } = createService();

    await service.record({ userId: 'user-1', connectionId: 'conn-1', sql: 'SELECT 1' });

    expect(queryHistory.create).toHaveBeenCalledWith({ data: { userId: 'user-1', connectionId: 'conn-1', sql: 'SELECT 1' } });
  });

  it('swallows write failures so a history error never breaks query execution', async () => {
    const create = vi.fn().mockRejectedValue(new Error('db down'));
    const { service } = createService({ create });

    await expect(
      service.record({ userId: 'user-1', connectionId: 'conn-1', sql: 'SELECT 1' }),
    ).resolves.toBeUndefined();
  });
});

describe('HistoryService.search', () => {
  it('matches sql + label, narrows to a connection, and caps the limit', async () => {
    const { service, queryHistory } = createService();

    await service.search('user-1', { search: 'users', connectionId: 'conn-1', limit: 999 });

    expect(queryHistory.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        connectionId: 'conn-1',
        OR: [{ sql: { contains: 'users' } }, { label: { contains: 'users' } }],
      },
      orderBy: { executedAt: 'desc' },
      take: 200,
      include: { connection: { select: { name: true } } },
    });
  });

  it('omits the connection and text filters when not provided (all connections)', async () => {
    const { service, queryHistory } = createService();

    await service.search('user-1', {});

    expect(queryHistory.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      orderBy: { executedAt: 'desc' },
      take: 50,
      include: { connection: { select: { name: true } } },
    });
  });
});

describe('HistoryService.update / remove — ownership', () => {
  it("updates star/label when the entry belongs to the user", async () => {
    const findUnique = vi.fn().mockResolvedValue({ userId: 'user-1' });
    const update = vi.fn().mockResolvedValue(buildEntry({ starred: true }));
    const { service, queryHistory } = createService({ findUnique, update });

    await service.update('user-1', 'hist-1', { starred: true, label: 'pinned' });

    expect(queryHistory.update).toHaveBeenCalledWith({
      where: { id: 'hist-1' },
      data: { starred: true, label: 'pinned' },
      include: { connection: { select: { name: true } } },
    });
  });

  it("404s on another user's entry and never mutates", async () => {
    const findUnique = vi.fn().mockResolvedValue({ userId: 'someone-else' });
    const update = vi.fn();
    const { service } = createService({ findUnique, update });

    await expect(service.update('user-1', 'hist-1', { starred: true })).rejects.toThrow(/not found/i);
    expect(update).not.toHaveBeenCalled();
  });

  it('404s on remove for a missing entry and never deletes', async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const del = vi.fn();
    const { service } = createService({ findUnique, delete: del });

    await expect(service.remove('user-1', 'hist-1')).rejects.toThrow(/not found/i);
    expect(del).not.toHaveBeenCalled();
  });
});

describe('HistoryService.clear', () => {
  it('deletes only the user\'s non-starred entries, optionally per connection (starred kept)', async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 3 });
    const { service } = createService({ deleteMany });

    await service.clear('user-1', 'conn-1');

    expect(deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', starred: false, connectionId: 'conn-1' },
    });
  });
});

describe('HistoryService.exportAll', () => {
  it('returns SQL text + metadata only — no result/row data', async () => {
    const findMany = vi.fn().mockResolvedValue([buildEntry({ starred: true, label: 'pinned' })]);
    const { service } = createService({ findMany });

    const result = await service.exportAll('user-1');

    expect(result).toEqual([
      {
        sql: 'SELECT * FROM users',
        executedAt: '2026-01-01T00:00:00.000Z',
        connectionName: 'Local PG',
        starred: true,
        label: 'pinned',
      },
    ]);
    // §1 guard: nothing resembling result rows/values is exported.
    const keys = Object.keys(result[0]!);
    expect(keys).not.toContain('rows');
    expect(keys).not.toContain('values');
  });
});

describe('HistoryService retention sweep', () => {
  it('deletes non-starred entries older than the cutoff and keeps starred', async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 5 });
    const { service } = createService({ deleteMany });

    await service.onModuleInit();

    expect(deleteMany).toHaveBeenCalledTimes(1);
    const arg = deleteMany.mock.calls[0]![0];
    expect(arg.where.starred).toBe(false);
    expect(arg.where.executedAt.lt).toBeInstanceOf(Date);

    service.onModuleDestroy();
  });
});
