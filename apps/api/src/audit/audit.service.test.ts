import { ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { AuditEntry } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service';
import { AuditService, errorClassOf } from './audit.service';

function row(id: string, over: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id,
    userId: 'u1',
    connectionId: 'c1',
    action: 'update',
    targetSchema: null,
    targetTable: null,
    sql: 'UPDATE t SET a = ?',
    outcome: 'success',
    errorClass: null,
    durationMs: 1,
    correlationId: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...over,
  } as AuditEntry;
}

function makeService(over: {
  create?: ReturnType<typeof vi.fn>;
  findMany?: ReturnType<typeof vi.fn>;
  deleteMany?: ReturnType<typeof vi.fn>;
  connectionFindMany?: ReturnType<typeof vi.fn>;
  retentionDays?: number;
} = {}) {
  const auditEntry = {
    create: over.create ?? vi.fn().mockResolvedValue({}),
    findMany: over.findMany ?? vi.fn().mockResolvedValue([]),
    deleteMany: over.deleteMany ?? vi.fn().mockResolvedValue({ count: 0 }),
  };
  const connection = { findMany: over.connectionFindMany ?? vi.fn().mockResolvedValue([]) };
  const prisma = { auditEntry, connection } as unknown as PrismaService;
  const config = { get: () => over.retentionDays ?? 0 } as unknown as ConfigService;
  return { service: new AuditService(prisma, config), auditEntry, connection };
}

describe('errorClassOf', () => {
  it('prefers the driver code, then the exception name, else Error', () => {
    expect(errorClassOf(Object.assign(new Error('x'), { code: '23505' }))).toBe('23505');
    expect(errorClassOf(new ForbiddenException())).toBe('ForbiddenException');
    expect(errorClassOf('weird')).toBe('Error');
  });
});

describe('AuditService.record', () => {
  it('persists only identifier/metadata columns — never value/row fields', async () => {
    const { service, auditEntry } = makeService();
    await service.record({
      userId: 'u1', connectionId: 'c1', action: 'update', sql: 'UPDATE t SET a = ?', outcome: 'success', durationMs: 5,
    });
    const data = auditEntry.create.mock.calls[0]![0].data as Record<string, unknown>;
    expect(Object.keys(data).sort()).toEqual([
      'action', 'connectionId', 'correlationId', 'durationMs', 'errorClass', 'outcome', 'sql', 'targetSchema', 'targetTable', 'userId',
    ]);
    expect(data.sql).toBe('UPDATE t SET a = ?');
  });

  it('never throws when the write fails (fire-and-forget)', async () => {
    const create = vi.fn().mockRejectedValue(new Error('db down'));
    const { service } = makeService({ create });
    await expect(service.record({ userId: 'u1', connectionId: 'c1', action: 'ddl', sql: 'DROP TABLE t', outcome: 'failure', durationMs: 0 })).resolves.toBeUndefined();
  });
});

describe('AuditService.withAudit', () => {
  const base = { userId: 'u1', connectionId: 'c1', action: 'ddl' as const, sql: 'DROP TABLE t' };

  it('records a success entry and returns the result', async () => {
    const { service, auditEntry } = makeService();
    const result = await service.withAudit(base, async () => 'ok');
    expect(result).toBe('ok');
    expect(auditEntry.create).toHaveBeenCalledWith({ data: expect.objectContaining({ outcome: 'success', action: 'ddl' }) });
  });

  it('records a failure entry with the error class and rethrows', async () => {
    const { service, auditEntry } = makeService();
    const err = Object.assign(new Error('nope'), { code: '23502' });
    await expect(service.withAudit(base, async () => { throw err; })).rejects.toBe(err);
    expect(auditEntry.create).toHaveBeenCalledWith({ data: expect.objectContaining({ outcome: 'failure', errorClass: '23502' }) });
  });
});

describe('AuditService.list', () => {
  it('applies filters, cursor-pages, and resolves the connection name', async () => {
    const findMany = vi.fn().mockResolvedValue([row('e3'), row('e2'), row('e1')]); // take+1 → hasMore
    const connectionFindMany = vi.fn().mockResolvedValue([{ id: 'c1', name: 'Demo' }]);
    const { service } = makeService({ findMany, connectionFindMany });

    const res = await service.list('u1', { connectionId: 'c1', action: 'update', outcome: 'success', limit: 2 });

    expect(res.entries).toHaveLength(2);
    expect(res.nextCursor).toBe('e2');
    expect(res.entries[0]!.connectionName).toBe('Demo');
    const where = findMany.mock.calls[0]![0].where;
    expect(where).toMatchObject({ userId: 'u1', connectionId: 'c1', action: 'update', outcome: 'success' });
  });
});

describe('AuditService retention', () => {
  it('prunes rows older than the retention window on init', async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 3 });
    const { service, auditEntry } = makeService({ deleteMany, retentionDays: 30 });
    await service.onModuleInit();
    expect(auditEntry.deleteMany).toHaveBeenCalledWith({ where: { createdAt: { lt: expect.any(Date) } } });
    service.onModuleDestroy();
  });
});
