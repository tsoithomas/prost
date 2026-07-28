import { describe, expect, it, vi, type Mock } from 'vitest';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { ColumnMetadata } from '@prost/shared-types';
import { ImportService } from './import.service';
import type { MetadataService } from '../metadata/metadata.service';
import type { AuditService } from '../audit/audit.service';
import type { PoolManager } from '../database/pool-manager.service';
import type { DriverResult, SqlFragment } from '../database/types';
import { PgDriver } from '../database/drivers/pg/pg-driver';

const COLUMNS: ColumnMetadata[] = [
  { name: 'id', dataType: 'integer', nullable: false, isPrimaryKey: true, autoIncrement: true, defaultValue: null },
  { name: 'email', dataType: 'text', nullable: false, isPrimaryKey: false, autoIncrement: false, defaultValue: null },
  { name: 'name', dataType: 'text', nullable: true, isPrimaryKey: false, autoIncrement: false, defaultValue: null },
];

function createService(opts: { columns?: ColumnMetadata[]; readOnly?: boolean } = {}) {
  const driver = new PgDriver({ get: () => undefined } as unknown as ConfigService);
  const q: Mock<(frag: SqlFragment) => Promise<DriverResult>> = vi.fn().mockResolvedValue({
    rows: [],
    fields: [],
    rowCount: 1,
    command: 'INSERT',
  });
  const withTransaction = vi.fn(async (_id: string, fn: (query: typeof q) => unknown) => fn(q));
  const assertWritable = opts.readOnly
    ? vi.fn().mockRejectedValue(new ForbiddenException('This connection is read-only'))
    : vi.fn().mockResolvedValue(undefined);
  const pool = {
    driverFor: vi.fn().mockResolvedValue(driver),
    withTransaction,
    assertWritable,
  } as unknown as PoolManager;
  const metadata = {
    getTableColumns: vi.fn().mockResolvedValue(opts.columns ?? COLUMNS),
  } as unknown as MetadataService;
  const audit = { withAudit: vi.fn((_base: unknown, fn: () => unknown) => fn()), record: vi.fn() } as unknown as AuditService;

  return { service: new ImportService(pool, metadata, audit), q, withTransaction, assertWritable };
}

const CTX = { userId: 'u1', correlationId: 'corr-1' };

describe('ImportService.batch', () => {
  it('inserts each row via a parameterized statement in one transaction', async () => {
    const { service, q, withTransaction } = createService();
    const res = await service.batch(
      'c1',
      { schema: 'public', table: 'users', columns: ['email', 'name'], rows: [['a@x.com', 'Ann'], ['b@x.com', null]] },
      CTX,
    );

    expect(res).toEqual({ inserted: 2 });
    expect(withTransaction).toHaveBeenCalledTimes(1);
    expect(q).toHaveBeenCalledTimes(2);
    const first = q.mock.calls[0]![0];
    // Values bind as params — never interpolated into the SQL.
    expect(first.sql).toMatch(/insert into/i);
    expect(first.sql).toContain('$1');
    expect(first.params).toEqual(['a@x.com', 'Ann']);
    expect(first.sql).not.toContain('a@x.com');
  });

  it('rejects an unknown target column and runs nothing', async () => {
    const { service, withTransaction } = createService();
    await expect(
      service.batch('c1', { schema: 'public', table: 'users', columns: ['email', 'ghost'], rows: [['a', 'b']] }, CTX),
    ).rejects.toThrow(BadRequestException);
    expect(withTransaction).not.toHaveBeenCalled();
  });

  it('rejects a row whose value count does not match the columns', async () => {
    const { service, withTransaction } = createService();
    await expect(
      service.batch('c1', { schema: 'public', table: 'users', columns: ['email', 'name'], rows: [['only-one']] }, CTX),
    ).rejects.toThrow(BadRequestException);
    expect(withTransaction).not.toHaveBeenCalled();
  });

  it('rejects a read-only connection before inserting', async () => {
    const { service, withTransaction } = createService({ readOnly: true });
    await expect(
      service.batch('c1', { schema: 'public', table: 'users', columns: ['email'], rows: [['a@x.com']] }, CTX),
    ).rejects.toThrow(ForbiddenException);
    expect(withTransaction).not.toHaveBeenCalled();
  });

  it('404s an unknown table', async () => {
    const { service } = createService({ columns: [] });
    await expect(
      service.batch('c1', { schema: 'public', table: 'ghost', columns: ['email'], rows: [['a@x.com']] }, CTX),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('ImportService.preview', () => {
  it('returns the parameterized INSERT shape with no issues for a valid mapping', async () => {
    const { service } = createService();
    const res = await service.preview('c1', {
      schema: 'public',
      table: 'users',
      columns: ['email', 'name'],
      sampleRows: [['a@x.com', 'Ann']],
    });
    expect(res.issues).toEqual([]);
    expect(res.sql).toMatch(/insert into/i);
    expect(res.sql).toContain('$1');
    expect(res.sql).not.toContain('a@x.com');
  });

  it('reports unknown and duplicate columns as issues without an INSERT shape', async () => {
    const { service } = createService();
    const res = await service.preview('c1', {
      schema: 'public',
      table: 'users',
      columns: ['email', 'email', 'ghost'],
      sampleRows: [],
    });
    expect(res.sql).toBe('');
    expect(res.issues).toEqual(expect.arrayContaining([expect.stringContaining('Duplicate'), expect.stringContaining('Unknown')]));
  });
});
