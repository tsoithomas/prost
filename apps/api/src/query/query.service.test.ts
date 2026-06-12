import { describe, expect, it, vi } from 'vitest';
import type { ColumnMetadata } from '@prost/shared-types';
import type { HistoryService } from '../history/history.service';
import type { MetadataService } from '../metadata/metadata.service';
import type { ParameterizedResult, PgConnectionService } from '../target-db/pg-connection.service';
import { QUERY_PAGE_SIZE } from './paging';
import { QueryService } from './query.service';

const USERS_COLUMNS: ColumnMetadata[] = [
  { name: 'id', dataType: 'integer', nullable: false, isPrimaryKey: true },
  { name: 'email', dataType: 'character varying', nullable: false, isPrimaryKey: false },
];

const NO_PK_COLUMNS: ColumnMetadata[] = [{ name: 'value', dataType: 'integer', nullable: false, isPrimaryKey: false }];

function result<T extends Record<string, unknown>>(
  rows: T[],
  overrides: Partial<ParameterizedResult<T>> = {},
): ParameterizedResult<T> {
  return { rows, fields: [], rowCount: rows.length, command: 'SELECT', ...overrides };
}

function pgTypeResult(types: Record<number, string>): ParameterizedResult<{ oid: number; typname: string }> {
  const rows = Object.entries(types).map(([oid, typname]) => ({ oid: Number(oid), typname }));
  return result(rows);
}

function createService(runParameterized = vi.fn(), tableColumns: ColumnMetadata[] = USERS_COLUMNS) {
  const metadataService = { getTableColumns: vi.fn().mockResolvedValue(tableColumns) } as unknown as MetadataService;
  const pgConnectionService = { runParameterized } as unknown as PgConnectionService;
  const record = vi.fn().mockResolvedValue(undefined);
  const historyService = { record } as unknown as HistoryService;

  return {
    service: new QueryService(pgConnectionService, metadataService, historyService),
    runParameterized,
    metadataService,
    record,
  };
}

describe('QueryService.execute — SELECT', () => {
  it('wraps a single-table SELECT in the paged window with bound limit/offset', async () => {
    const runParameterized = vi
      .fn()
      .mockResolvedValueOnce(
        result([{ id: 1, email: 'a@x.com' }], {
          fields: [
            { name: 'id', dataTypeID: 23 },
            { name: 'email', dataTypeID: 1043 },
          ],
        }),
      )
      .mockResolvedValueOnce(pgTypeResult({ 23: 'int4', 1043: 'varchar' }));
    const { service, metadataService, record } = createService(runParameterized);

    const response = await service.execute('conn-1', 'SELECT * FROM users', 'user-1');

    const [connectionId, sql, params] = runParameterized.mock.calls[0]!;
    expect(connectionId).toBe('conn-1');
    expect(sql).toBe('SELECT * FROM (SELECT * FROM users) AS __prost_query LIMIT $1 OFFSET $2');
    expect(params).toEqual([QUERY_PAGE_SIZE + 1, 0]);
    expect(metadataService.getTableColumns).toHaveBeenCalledWith('conn-1', 'public', 'users');

    expect(response).toMatchObject({
      rows: [{ id: 1, email: 'a@x.com' }],
      columns: [
        { name: 'id', dataType: 'int4', nullable: true, isPrimaryKey: true },
        { name: 'email', dataType: 'varchar', nullable: true, isPrimaryKey: false },
      ],
      totalRows: 1,
      truncated: false,
      editable: true,
      sourceTable: 'public.users',
      primaryKey: ['id'],
    });
    expect(response.executionTimeMs).toBeGreaterThanOrEqual(0);

    expect(record).toHaveBeenCalledWith({ userId: 'user-1', connectionId: 'conn-1', sql: 'SELECT * FROM users' });
  });

  it('marks SELECT COUNT(*) as read-only even though it targets one table', async () => {
    const runParameterized = vi
      .fn()
      .mockResolvedValueOnce(result([{ count: '5' }], { fields: [{ name: 'count', dataTypeID: 20 }] }))
      .mockResolvedValueOnce(pgTypeResult({ 20: 'int8' }));
    const { service, metadataService } = createService(runParameterized);

    const response = await service.execute('conn-1', 'SELECT COUNT(*) FROM users', 'user-1');

    expect(metadataService.getTableColumns).toHaveBeenCalledWith('conn-1', 'public', 'users');
    expect(response.editable).toBe(false);
    expect(response.sourceTable).toBeUndefined();
    expect(response.primaryKey).toBeUndefined();
  });

  it('marks a join as read-only without resolving table metadata', async () => {
    const runParameterized = vi
      .fn()
      .mockResolvedValueOnce(result([{ id: 1 }], { fields: [{ name: 'id', dataTypeID: 23 }] }))
      .mockResolvedValueOnce(pgTypeResult({ 23: 'int4' }));
    const { service, metadataService } = createService(runParameterized);

    const response = await service.execute(
      'conn-1',
      'SELECT * FROM users JOIN orders ON orders.user_id = users.id',
      'user-1',
    );

    expect(metadataService.getTableColumns).not.toHaveBeenCalled();
    expect(response.editable).toBe(false);
  });

  it('caps rows at the page size and signals truncation', async () => {
    const rows = Array.from({ length: QUERY_PAGE_SIZE + 1 }, (_, i) => ({ value: i }));
    const runParameterized = vi
      .fn()
      .mockResolvedValueOnce(result(rows, { fields: [{ name: 'value', dataTypeID: 23 }] }))
      .mockResolvedValueOnce(pgTypeResult({ 23: 'int4' }));
    const { service } = createService(runParameterized, NO_PK_COLUMNS);

    const response = await service.execute('conn-1', 'SELECT * FROM big_table', 'user-1');

    expect(response.rows).toHaveLength(QUERY_PAGE_SIZE);
    expect(response.totalRows).toBe(QUERY_PAGE_SIZE);
    expect(response.truncated).toBe(true);
    expect(response.editable).toBe(false);
  });
});

describe('QueryService.execute — non-SELECT', () => {
  it('returns an affected-row count instead of a grid for UPDATE', async () => {
    const runParameterized = vi.fn().mockResolvedValueOnce(result([], { rowCount: 1, command: 'UPDATE' }));
    const { service, metadataService, record } = createService(runParameterized);

    const response = await service.execute('conn-1', "UPDATE users SET email = 'x' WHERE id = 1", 'user-1');

    const [connectionId, sql] = runParameterized.mock.calls[0]!;
    expect(connectionId).toBe('conn-1');
    expect(sql).toBe("UPDATE users SET email = 'x' WHERE id = 1");
    expect(runParameterized).toHaveBeenCalledTimes(1);
    expect(metadataService.getTableColumns).not.toHaveBeenCalled();

    expect(response).toMatchObject({
      rows: [],
      columns: [],
      totalRows: 0,
      editable: false,
      command: 'UPDATE',
      rowCount: 1,
    });

    expect(record).toHaveBeenCalledWith({
      userId: 'user-1',
      connectionId: 'conn-1',
      sql: "UPDATE users SET email = 'x' WHERE id = 1",
    });
  });

  it('falls back to executing unparseable SQL as-is and surfaces the driver error', async () => {
    const runParameterized = vi.fn().mockRejectedValueOnce(new Error('syntax error'));
    const { service, record } = createService(runParameterized);

    await expect(service.execute('conn-1', 'SELEKT * FROM users', 'user-1')).rejects.toThrow('syntax error');

    const [, sql] = runParameterized.mock.calls[0]!;
    expect(sql).toBe('SELEKT * FROM users');
    expect(record).not.toHaveBeenCalled();
  });
});
