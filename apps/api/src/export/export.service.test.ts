import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { ColumnMetadata } from '@prost/shared-types';
import { ExportService, type ExportWriter } from './export.service';
import type { MetadataService } from '../metadata/metadata.service';
import type { QueryService } from '../query/query.service';
import type { PoolManager } from '../database/pool-manager.service';
import type { DriverCursor, SqlFragment } from '../database/types';
import { PgDriver } from '../database/drivers/pg/pg-driver';

const COLUMNS: ColumnMetadata[] = [
  { name: 'id', dataType: 'integer', nullable: false, isPrimaryKey: true, autoIncrement: false, defaultValue: null },
  { name: 'note', dataType: 'text', nullable: true, isPrimaryKey: false, autoIncrement: false, defaultValue: null },
];

/** A fake forward-only cursor yielding the given blocks; the last block sets `complete`. */
function fakeCursor(blocks: Record<string, unknown>[][], onClose?: () => void): DriverCursor & { fetch: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> } {
  let i = 0;
  const close = vi.fn(async () => onClose?.());
  const fetch = vi.fn(async () => {
    const rows = blocks[i] ?? [];
    i += 1;
    const complete = i >= blocks.length;
    return { rows, complete };
  });
  return {
    fetch,
    close,
    columns: () => [
      { name: 'id', dataTypeID: 23 },
      { name: 'note', dataTypeID: 25 },
    ],
  };
}

function createService(opts: {
  cursor?: DriverCursor;
  columns?: ColumnMetadata[];
  maxRows?: number;
  openCursor?: ReturnType<typeof vi.fn>;
  resolveSingleSelect?: ReturnType<typeof vi.fn>;
  run?: ReturnType<typeof vi.fn>;
} = {}) {
  const driver = new PgDriver({ get: () => undefined } as unknown as ConfigService);
  const openCursor = opts.openCursor ?? vi.fn().mockResolvedValue(opts.cursor ?? fakeCursor([[]]));
  const run = opts.run ?? vi.fn().mockResolvedValue({ rows: [], fields: [], rowCount: 0, command: 'SELECT' });
  const pool = {
    driverFor: vi.fn().mockResolvedValue(driver),
    openCursor,
    run,
  } as unknown as PoolManager;
  const metadata = {
    getTableColumns: vi.fn().mockResolvedValue(opts.columns ?? COLUMNS),
    getTableStructure: vi.fn().mockResolvedValue({ columns: opts.columns ?? COLUMNS, indexes: [], foreignKeys: [] }),
  } as unknown as MetadataService;
  const queryService = {
    resolveSingleSelect: opts.resolveSingleSelect ?? vi.fn().mockResolvedValue('SELECT * FROM users'),
  } as unknown as QueryService;
  const config = { get: (k: string) => (k === 'STREAM_MAX_ROWS' ? opts.maxRows ?? 100_000 : undefined) } as unknown as ConfigService;

  return { service: new ExportService(pool, metadata, queryService, config), openCursor, metadata, queryService, run };
}

/** A `run` mock returning faithful PG DDL columns (what `pgBuildTableColumnsForDdl` yields). */
function pgDdlColumnsRun() {
  return vi.fn().mockResolvedValue({
    rows: [
      { name: 'id', type: 'integer', not_null: true, default: null },
      { name: 'note', type: 'text', not_null: false, default: null },
    ],
    fields: [],
    rowCount: 2,
    command: 'SELECT',
  });
}

function collector(): ExportWriter & { text: () => string } {
  const chunks: string[] = [];
  return { write: (c) => chunks.push(c), text: () => chunks.join('') };
}

describe('ExportService — table scope', () => {
  it('streams a CSV header + rows, distinguishing NULL from empty string', async () => {
    const cursor = fakeCursor([[{ id: 1, note: 'hi' }, { id: 2, note: null }, { id: 3, note: '' }]]);
    const { service } = createService({ cursor });
    const out = collector();

    const prepared = await service.prepare('c1', { scope: 'table', format: 'csv', schema: 'public', table: 'users' });
    const res = await service.stream(out, 'c1', prepared);

    expect(out.text()).toBe('id,note\r\n1,hi\r\n2,\r\n3,""\r\n');
    expect(res).toEqual({ rowCount: 3, truncated: false });
    expect(cursor.close).toHaveBeenCalled();
  });

  it('applies the row filter to the streamed statement', async () => {
    const { service, openCursor } = createService({ cursor: fakeCursor([[]]) });
    const prepared = await service.prepare('c1', {
      scope: 'table',
      format: 'csv',
      schema: 'public',
      table: 'users',
      filter: { combinator: 'and', conditions: [{ column: 'id', operator: 'eq', value: 5 }] },
    });
    await service.stream(collector(), 'c1', prepared);

    const frag = (openCursor.mock.calls[0]![1]) as SqlFragment;
    expect(frag.sql).toMatch(/WHERE/i);
    expect(frag.params).toContain(5);
  });

  it('emits a JSON array', async () => {
    const cursor = fakeCursor([[{ id: 1, note: 'a' }, { id: 2, note: 'b' }]]);
    const { service } = createService({ cursor });
    const out = collector();
    const prepared = await service.prepare('c1', { scope: 'table', format: 'json', schema: 'public', table: 'users' });
    await service.stream(out, 'c1', prepared);
    expect(JSON.parse(out.text())).toEqual([{ id: 1, note: 'a' }, { id: 2, note: 'b' }]);
  });

  it('stops at the row budget and appends a CSV truncation trailer', async () => {
    // Budget of 2; the cursor keeps yielding and never completes.
    const cursor = fakeCursor([[{ id: 1, note: 'a' }, { id: 2, note: 'b' }], [{ id: 3, note: 'c' }]]);
    const { service } = createService({ cursor, maxRows: 2 });
    const out = collector();
    const prepared = await service.prepare('c1', { scope: 'table', format: 'csv', schema: 'public', table: 'users' });
    const res = await service.stream(out, 'c1', prepared);

    expect(res).toEqual({ rowCount: 2, truncated: true });
    expect(out.text()).toContain('# truncated at 2 rows');
    expect(cursor.close).toHaveBeenCalled();
  });

  it('404s an unknown table before streaming', async () => {
    const { service } = createService({ columns: [] });
    await expect(
      service.prepare('c1', { scope: 'table', format: 'csv', schema: 'public', table: 'ghost' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('closes the cursor even when fetch throws mid-stream', async () => {
    const close = vi.fn(async () => undefined);
    const cursor: DriverCursor = {
      fetch: vi.fn().mockRejectedValue(new Error('boom')),
      columns: () => [{ name: 'id', dataTypeID: 23 }],
      close,
    };
    const { service } = createService({ cursor });
    const prepared = await service.prepare('c1', { scope: 'table', format: 'json', schema: 'public', table: 'users' });
    await expect(service.stream(collector(), 'c1', prepared)).rejects.toThrow('boom');
    expect(close).toHaveBeenCalled();
  });
});

describe('ExportService — query scope', () => {
  it('validates a single SELECT and streams it with no bound params', async () => {
    const resolveSingleSelect = vi.fn().mockResolvedValue('SELECT id FROM users');
    const { service, openCursor } = createService({ cursor: fakeCursor([[]]), resolveSingleSelect });
    const prepared = await service.prepare('c1', { scope: 'query', format: 'csv', sql: 'SELECT id FROM users' });
    await service.stream(collector(), 'c1', prepared);

    expect(resolveSingleSelect).toHaveBeenCalledWith('c1', 'SELECT id FROM users');
    const frag = openCursor.mock.calls[0]![1] as SqlFragment;
    expect(frag.params).toEqual([]);
    expect(frag.sql).toContain('SELECT id FROM users');
  });

  it('rejects a query export with no sql', async () => {
    const { service } = createService();
    await expect(service.prepare('c1', { scope: 'query', format: 'csv' })).rejects.toThrow(BadRequestException);
  });
});

describe('ExportService — SQL format', () => {
  it('emits CREATE TABLE then batched multi-row INSERTs, escaping values', async () => {
    const cursor = fakeCursor([[{ id: 1, note: 'a' }, { id: 2, note: "b'c" }]]);
    const { service } = createService({ cursor, run: pgDdlColumnsRun() });
    const out = collector();

    const prepared = await service.prepare('c1', { scope: 'table', format: 'sql', schema: 'public', table: 'users' });
    const res = await service.stream(out, 'c1', prepared);
    const text = out.text();

    expect(text).toContain('CREATE TABLE "public"."users"');
    expect(text).toContain('INSERT INTO "public"."users" ("id", "note") VALUES');
    // Both rows are in a single (batched) statement.
    expect(text.match(/INSERT INTO/g)).toHaveLength(1);
    expect(text).toContain("(1, 'a')");
    expect(text).toContain("(2, 'b''c')"); // single quote doubled
    expect(res.rowCount).toBe(2);
  });

  it('honours includeSchema:false (no DDL) and includeData:false (no INSERT)', async () => {
    const dataOnly = createService({ cursor: fakeCursor([[{ id: 1, note: 'x' }]]), run: pgDdlColumnsRun() });
    const out1 = collector();
    await dataOnly.service.stream(
      out1, 'c1',
      await dataOnly.service.prepare('c1', { scope: 'table', format: 'sql', schema: 'public', table: 'users', includeSchema: false }),
    );
    expect(out1.text()).not.toContain('CREATE TABLE');
    expect(out1.text()).toContain('INSERT INTO');

    const schemaOnly = createService({ run: pgDdlColumnsRun() });
    const out2 = collector();
    await schemaOnly.service.stream(
      out2, 'c1',
      await schemaOnly.service.prepare('c1', { scope: 'table', format: 'sql', schema: 'public', table: 'users', includeData: false }),
    );
    expect(out2.text()).toContain('CREATE TABLE');
    expect(out2.text()).not.toContain('INSERT INTO');
  });

  it('loops multiple tables in selection order (schema scope)', async () => {
    const { service } = createService({ run: pgDdlColumnsRun() });
    const out = collector();
    const prepared = await service.prepare('c1', {
      scope: 'schema', format: 'sql', schema: 'public', tables: ['orders', 'users'], includeData: false,
    });
    await service.stream(out, 'c1', prepared);
    const text = out.text();
    expect(text.indexOf('-- public.orders')).toBeGreaterThanOrEqual(0);
    expect(text.indexOf('-- public.orders')).toBeLessThan(text.indexOf('-- public.users'));
  });

  it('rejects sql format for a query result', async () => {
    const { service } = createService();
    await expect(
      service.prepare('c1', { scope: 'query', format: 'sql', sql: 'SELECT 1' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a schema export with no tables selected', async () => {
    const { service } = createService();
    await expect(
      service.prepare('c1', { scope: 'schema', format: 'sql', schema: 'public', tables: [] }),
    ).rejects.toThrow(BadRequestException);
  });

  it('404s when a selected table does not exist', async () => {
    const { service, metadata } = createService();
    (metadata.getTableColumns as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    await expect(
      service.prepare('c1', { scope: 'schema', format: 'sql', schema: 'public', tables: ['ghost'] }),
    ).rejects.toThrow(NotFoundException);
  });
});
