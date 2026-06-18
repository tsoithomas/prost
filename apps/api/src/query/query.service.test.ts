import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import type { ColumnMetadata, StatementResult } from '@prost/shared-types';
import { PgDriver } from '../database/drivers/pg/pg-driver';
import type { PoolManager } from '../database/pool-manager.service';
import type { DriverResult, SqlFragment } from '../database/types';
import type { HistoryService } from '../history/history.service';
import type { MetadataService } from '../metadata/metadata.service';
import { QUERY_PAGE_SIZE } from './paging';
import { QueryService } from './query.service';

const USERS_COLUMNS: ColumnMetadata[] = [
  { name: 'id', dataType: 'integer', nullable: false, isPrimaryKey: true, autoIncrement: false, defaultValue: null },
  { name: 'email', dataType: 'character varying', nullable: false, isPrimaryKey: false, autoIncrement: false, defaultValue: null },
];

const NO_PK_COLUMNS: ColumnMetadata[] = [
  { name: 'value', dataType: 'integer', nullable: false, isPrimaryKey: false, autoIncrement: false, defaultValue: null },
];

function result<T extends Record<string, unknown>>(rows: T[], overrides: Partial<DriverResult> = {}): DriverResult {
  return { rows, fields: [], rowCount: rows.length, command: 'SELECT', ...overrides } as DriverResult;
}

function pgTypeResult(types: Record<number, string>): DriverResult {
  const rows = Object.entries(types).map(([oid, typname]) => ({ oid: Number(oid), typname }));
  return result(rows);
}

function createService(run = vi.fn(), tableColumns: ColumnMetadata[] = USERS_COLUMNS) {
  const metadataService = { getTableColumns: vi.fn().mockResolvedValue(tableColumns) } as unknown as MetadataService;

  // Real driver: parser dialect comes from its capabilities, and `buildResolveTypeNames`
  // produces the pg_type lookup fragment that `pool.run` receives during column mapping.
  const driver = new PgDriver({ get: () => undefined } as unknown as ConfigService);

  // `PoolManager.run(connectionId, frag)` — the run mock receives `(connectionId, { sql, params })`.
  const pool = { run, withTransaction: vi.fn(), driverFor: vi.fn().mockResolvedValue(driver) } as unknown as PoolManager;

  // Mirrors `PoolManager.withTransaction`: runs `fn` against a `query` callback that proxies to
  // the same `run` mock, so transactional tests assert on the same call queue as autocommit tests.
  (pool.withTransaction as ReturnType<typeof vi.fn>).mockImplementation(
    async (connectionId: string, fn: (query: (frag: SqlFragment) => Promise<DriverResult>) => Promise<unknown>) => {
      const query = (frag: SqlFragment) => run(connectionId, frag);
      return fn(query);
    },
  );

  const record = vi.fn().mockResolvedValue(undefined);
  const historyService = { record } as unknown as HistoryService;

  return {
    service: new QueryService(pool, metadataService, historyService),
    run,
    withTransaction: pool.withTransaction as ReturnType<typeof vi.fn>,
    metadataService,
    record,
  };
}

function expectKind<K extends StatementResult['kind']>(stmt: StatementResult, kind: K): Extract<StatementResult, { kind: K }> {
  expect(stmt.kind).toBe(kind);
  return stmt as Extract<StatementResult, { kind: K }>;
}

describe('QueryService.execute — single statement, SELECT', () => {
  it('wraps a single-table SELECT in the paged window with bound limit/offset', async () => {
    const run = vi
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
    const { service, metadataService, record } = createService(run);

    const response = await service.execute('conn-1', 'SELECT * FROM users', 'user-1');

    const [connectionId, frag] = run.mock.calls[0]!;
    expect(connectionId).toBe('conn-1');
    expect(frag.sql).toBe('SELECT * FROM (SELECT * FROM users) AS __prost_query LIMIT $1 OFFSET $2');
    expect(frag.params).toEqual([QUERY_PAGE_SIZE + 1, 0]);
    expect(metadataService.getTableColumns).toHaveBeenCalledWith('conn-1', 'public', 'users');

    expect(response.transactional).toBe(false);
    expect(response.statementCount).toBe(1);
    expect(response.statements).toHaveLength(1);

    const stmt = expectKind(response.statements[0]!, 'rows');
    expect(stmt).toMatchObject({
      sql: 'SELECT * FROM users',
      rows: [{ id: 1, email: 'a@x.com' }],
      columns: [
        { name: 'id', dataType: 'int4', nullable: true, isPrimaryKey: true, autoIncrement: false, defaultValue: null },
        { name: 'email', dataType: 'varchar', nullable: true, isPrimaryKey: false, autoIncrement: false, defaultValue: null },
      ],
      totalRows: 1,
      truncated: false,
      editable: true,
      sourceTable: 'public.users',
      primaryKey: ['id'],
    });
    expect(stmt.executionTimeMs).toBeGreaterThanOrEqual(0);

    expect(record).toHaveBeenCalledWith({ userId: 'user-1', connectionId: 'conn-1', sql: 'SELECT * FROM users' });
  });

  it('marks SELECT COUNT(*) as read-only even though it targets one table', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(result([{ count: '5' }], { fields: [{ name: 'count', dataTypeID: 20 }] }))
      .mockResolvedValueOnce(pgTypeResult({ 20: 'int8' }));
    const { service, metadataService } = createService(run);

    const response = await service.execute('conn-1', 'SELECT COUNT(*) FROM users', 'user-1');

    expect(metadataService.getTableColumns).toHaveBeenCalledWith('conn-1', 'public', 'users');
    const stmt = expectKind(response.statements[0]!, 'rows');
    expect(stmt.editable).toBe(false);
    expect(stmt.sourceTable).toBeUndefined();
    expect(stmt.primaryKey).toBeUndefined();
  });

  it('marks a join as read-only without resolving table metadata', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(result([{ id: 1 }], { fields: [{ name: 'id', dataTypeID: 23 }] }))
      .mockResolvedValueOnce(pgTypeResult({ 23: 'int4' }));
    const { service, metadataService } = createService(run);

    const response = await service.execute('conn-1', 'SELECT * FROM users JOIN orders ON orders.user_id = users.id', 'user-1');

    expect(metadataService.getTableColumns).not.toHaveBeenCalled();
    const stmt = expectKind(response.statements[0]!, 'rows');
    expect(stmt.editable).toBe(false);
  });

  it('caps rows at the page size and signals truncation', async () => {
    const rows = Array.from({ length: QUERY_PAGE_SIZE + 1 }, (_, i) => ({ value: i }));
    const run = vi
      .fn()
      .mockResolvedValueOnce(result(rows, { fields: [{ name: 'value', dataTypeID: 23 }] }))
      .mockResolvedValueOnce(pgTypeResult({ 23: 'int4' }));
    const { service } = createService(run, NO_PK_COLUMNS);

    const response = await service.execute('conn-1', 'SELECT * FROM big_table', 'user-1');

    const stmt = expectKind(response.statements[0]!, 'rows');
    expect(stmt.rows).toHaveLength(QUERY_PAGE_SIZE);
    expect(stmt.totalRows).toBe(QUERY_PAGE_SIZE);
    expect(stmt.truncated).toBe(true);
    expect(stmt.editable).toBe(false);
  });
});

describe('QueryService.execute — single statement, unparsed SELECT', () => {
  const UNPARSEABLE_SELECT = 'SELECT * FROM big_table FOR UPDATE SKIP LOCKED';

  it('pages a SELECT that node-sql-parser cannot classify instead of loading it unbounded', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(result([{ id: 1 }], { fields: [{ name: 'id', dataTypeID: 23 }] }))
      .mockResolvedValueOnce(pgTypeResult({ 23: 'int4' }));
    const { service, metadataService, record } = createService(run);

    const response = await service.execute('conn-1', UNPARSEABLE_SELECT, 'user-1');

    const [connectionId, frag] = run.mock.calls[0]!;
    expect(connectionId).toBe('conn-1');
    expect(frag.sql).toBe(`SELECT * FROM (${UNPARSEABLE_SELECT}) AS __prost_query LIMIT $1 OFFSET $2`);
    expect(frag.params).toEqual([QUERY_PAGE_SIZE + 1, 0]);
    expect(metadataService.getTableColumns).not.toHaveBeenCalled();

    const stmt = expectKind(response.statements[0]!, 'rows');
    expect(stmt).toMatchObject({ rows: [{ id: 1 }], totalRows: 1, truncated: false, editable: false });
    expect(record).toHaveBeenCalledWith({ userId: 'user-1', connectionId: 'conn-1', sql: UNPARSEABLE_SELECT });
  });

  it('falls back to an unbounded execution if the paged wrapper itself fails', async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error('syntax error in wrapper'))
      .mockResolvedValueOnce(result([{ id: 1 }], { rowCount: 1, command: 'SELECT' }));
    const { service } = createService(run);

    const response = await service.execute('conn-1', UNPARSEABLE_SELECT, 'user-1');

    expect(run).toHaveBeenCalledTimes(2);
    const [, fallbackFrag] = run.mock.calls[1]!;
    expect(fallbackFrag.sql).toBe(UNPARSEABLE_SELECT);

    const stmt = expectKind(response.statements[0]!, 'command');
    expect(stmt).toMatchObject({ command: 'SELECT', rowCount: 1, sql: UNPARSEABLE_SELECT });
  });
});

describe('QueryService.execute — single statement, non-SELECT', () => {
  it('returns an affected-row count instead of a grid for UPDATE', async () => {
    const run = vi.fn().mockResolvedValueOnce(result([], { rowCount: 1, command: 'UPDATE' }));
    const { service, metadataService, record } = createService(run);

    const response = await service.execute('conn-1', "UPDATE users SET email = 'x' WHERE id = 1", 'user-1');

    const [connectionId, frag] = run.mock.calls[0]!;
    expect(connectionId).toBe('conn-1');
    expect(frag.sql).toBe("UPDATE users SET email = 'x' WHERE id = 1");
    expect(run).toHaveBeenCalledTimes(1);
    expect(metadataService.getTableColumns).not.toHaveBeenCalled();

    const stmt = expectKind(response.statements[0]!, 'command');
    expect(stmt).toMatchObject({ command: 'UPDATE', rowCount: 1, sql: "UPDATE users SET email = 'x' WHERE id = 1" });

    expect(record).toHaveBeenCalledWith({ userId: 'user-1', connectionId: 'conn-1', sql: "UPDATE users SET email = 'x' WHERE id = 1" });
  });

  it('returns a per-statement error result for unparseable SQL and still records history', async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error('syntax error'));
    const { service, record } = createService(run);

    const response = await service.execute('conn-1', 'SELEKT * FROM users', 'user-1', 'corr-1');

    const [, frag] = run.mock.calls[0]!;
    expect(frag.sql).toBe('SELEKT * FROM users');

    const stmt = expectKind(response.statements[0]!, 'error');
    expect(stmt).toMatchObject({ message: 'syntax error', sql: 'SELEKT * FROM users', correlationId: 'corr-1' });

    expect(record).toHaveBeenCalledWith({ userId: 'user-1', connectionId: 'conn-1', sql: 'SELEKT * FROM users' });
  });
});

describe('QueryService.execute — autocommit multi-statement', () => {
  it('runs multiple SELECTs in order, each independently paged', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(result([{ id: 1 }], { fields: [{ name: 'id', dataTypeID: 23 }] }))
      .mockResolvedValueOnce(pgTypeResult({ 23: 'int4' }))
      .mockResolvedValueOnce(result([{ name: 'widget' }], { fields: [{ name: 'name', dataTypeID: 1043 }] }))
      .mockResolvedValueOnce(pgTypeResult({ 1043: 'varchar' }));
    const { service, metadataService } = createService(run);

    const response = await service.execute('conn-1', 'SELECT id FROM users; SELECT name FROM products', 'user-1');

    expect(response.statements).toHaveLength(2);
    expect(response.statementCount).toBe(2);

    const first = expectKind(response.statements[0]!, 'rows');
    const second = expectKind(response.statements[1]!, 'rows');
    expect(first.rows).toEqual([{ id: 1 }]);
    expect(second.rows).toEqual([{ name: 'widget' }]);

    // Multi-statement scripts are never editable, even if a single statement would be (rule #4).
    expect(first.editable).toBe(false);
    expect(second.editable).toBe(false);
    expect(metadataService.getTableColumns).not.toHaveBeenCalled();
  });

  it('runs a mixed SELECT + UPDATE script, producing [rows, command]', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(result([{ id: 1 }], { fields: [{ name: 'id', dataTypeID: 23 }] }))
      .mockResolvedValueOnce(pgTypeResult({ 23: 'int4' }))
      .mockResolvedValueOnce(result([], { rowCount: 2, command: 'UPDATE' }));
    const { service } = createService(run);

    const response = await service.execute('conn-1', "SELECT id FROM users; UPDATE users SET email = 'x'", 'user-1');

    expect(response.statements).toHaveLength(2);
    expectKind(response.statements[0]!, 'rows');
    const command = expectKind(response.statements[1]!, 'command');
    expect(command).toMatchObject({ command: 'UPDATE', rowCount: 2 });
  });

  it('continues past a failing statement (honest partial success)', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(result([], { rowCount: 1, command: 'UPDATE' }))
      .mockRejectedValueOnce(Object.assign(new Error('duplicate key'), { code: '23505' }))
      .mockResolvedValueOnce(result([], { rowCount: 1, command: 'UPDATE' }));
    const { service } = createService(run);

    const response = await service.execute('conn-1', 'UPDATE a SET x = 1; INSERT INTO a VALUES (1); UPDATE b SET y = 1', 'user-1', 'corr-1');

    expect(response.statements).toHaveLength(3);
    expectKind(response.statements[0]!, 'command');
    const error = expectKind(response.statements[1]!, 'error');
    expect(error).toMatchObject({ code: '23505', message: 'duplicate key', correlationId: 'corr-1' });
    expectKind(response.statements[2]!, 'command');
    expect(run).toHaveBeenCalledTimes(3);
  });
});

describe('QueryService.execute — transactional', () => {
  it('runs BEGIN, each statement, and COMMIT in order when all statements succeed', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(result([], { rowCount: 0, command: 'BEGIN' }))
      .mockResolvedValueOnce(result([], { rowCount: 1, command: 'UPDATE' }))
      .mockResolvedValueOnce(result([], { rowCount: 1, command: 'UPDATE' }))
      .mockResolvedValueOnce(result([], { rowCount: 0, command: 'COMMIT' }));
    const { service, withTransaction } = createService(run);

    const response = await service.execute('conn-1', 'UPDATE a SET x = 1; UPDATE b SET y = 1', 'user-1', '', true);

    expect(withTransaction).toHaveBeenCalledOnce();
    expect(response.transactional).toBe(true);
    expect(response.statements).toHaveLength(2);

    const sqls = run.mock.calls.map(([, frag]) => frag.sql);
    expect(sqls).toEqual(['BEGIN', 'UPDATE a SET x = 1', 'UPDATE b SET y = 1', 'COMMIT']);
  });

  it('rolls back and stops after the first failing statement', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(result([], { rowCount: 0, command: 'BEGIN' }))
      .mockResolvedValueOnce(result([], { rowCount: 1, command: 'UPDATE' }))
      .mockRejectedValueOnce(Object.assign(new Error('duplicate key'), { code: '23505' }))
      .mockResolvedValueOnce(result([], { rowCount: 0, command: 'ROLLBACK' }));
    const { service } = createService(run);

    const response = await service.execute(
      'conn-1',
      'UPDATE a SET x = 1; INSERT INTO a VALUES (1); UPDATE b SET y = 1',
      'user-1',
      'corr-2',
      true,
    );

    expect(response.statements).toHaveLength(2);
    expectKind(response.statements[0]!, 'command');
    const error = expectKind(response.statements[1]!, 'error');
    expect(error).toMatchObject({ code: '23505', correlationId: 'corr-2' });
    expect(response.statementCount).toBe(3);

    const sqls = run.mock.calls.map(([, frag]) => frag.sql);
    expect(sqls).toEqual(['BEGIN', 'UPDATE a SET x = 1', 'INSERT INTO a VALUES (1)', 'ROLLBACK']);
    expect(sqls).not.toContain('COMMIT');
  });
});

describe('QueryService.execute — EXPLAIN', () => {
  it('classifies EXPLAIN as a plan result', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(
        result([{ 'QUERY PLAN': 'Seq Scan on users  (cost=0.00..1.05 rows=5 width=40)' }, { 'QUERY PLAN': '  Filter: (id > 1)' }]),
      );
    const { service } = createService(run);

    const response = await service.execute('conn-1', 'EXPLAIN SELECT * FROM users WHERE id > 1', 'user-1');

    const stmt = expectKind(response.statements[0]!, 'plan');
    expect(stmt.analyze).toBe(false);
    expect(stmt.planText).toBe('Seq Scan on users  (cost=0.00..1.05 rows=5 width=40)\n  Filter: (id > 1)');
    expect(stmt.sql).toBe('EXPLAIN SELECT * FROM users WHERE id > 1');

    const [, frag] = run.mock.calls[0]!;
    expect(frag.sql).toBe('EXPLAIN SELECT * FROM users WHERE id > 1');
  });

  it('marks EXPLAIN ANALYZE as analyze:true', async () => {
    const run = vi.fn().mockResolvedValueOnce(result([{ 'QUERY PLAN': 'Seq Scan ... (actual time=0.01..0.02 rows=5 loops=1)' }]));
    const { service } = createService(run);

    const response = await service.execute('conn-1', 'EXPLAIN ANALYZE SELECT * FROM users', 'user-1');

    const stmt = expectKind(response.statements[0]!, 'plan');
    expect(stmt.analyze).toBe(true);
  });

  it('marks EXPLAIN (ANALYZE, ...) as analyze:true', async () => {
    const run = vi.fn().mockResolvedValueOnce(result([{ 'QUERY PLAN': 'Seq Scan ...' }]));
    const { service } = createService(run);

    const response = await service.execute('conn-1', 'EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM users', 'user-1');

    const stmt = expectKind(response.statements[0]!, 'plan');
    expect(stmt.analyze).toBe(true);
  });

  it('does not let an EXPLAIN statement poison classification of sibling statements', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(result([{ 'QUERY PLAN': 'Seq Scan ...' }]))
      .mockResolvedValueOnce(result([{ id: 1 }], { fields: [{ name: 'id', dataTypeID: 23 }] }))
      .mockResolvedValueOnce(pgTypeResult({ 23: 'int4' }));
    const { service } = createService(run);

    const response = await service.execute('conn-1', 'EXPLAIN SELECT * FROM users; SELECT id FROM users', 'user-1');

    expectKind(response.statements[0]!, 'plan');
    expectKind(response.statements[1]!, 'rows');
  });
});

describe('QueryService.execute — empty input', () => {
  it('returns an empty result without executing or recording history', async () => {
    const run = vi.fn();
    const { service, record } = createService(run);

    const response = await service.execute('conn-1', '   \n  ', 'user-1');

    expect(response).toEqual({ statements: [], transactional: false, statementCount: 0 });
    expect(run).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });
});
