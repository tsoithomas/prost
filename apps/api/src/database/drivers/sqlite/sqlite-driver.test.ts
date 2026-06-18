import type { ConfigService } from '@nestjs/config';
import type { ColumnMetadata } from '@prost/shared-types';
import { describe, expect, it, vi } from 'vitest';
import { SqliteDriver } from './sqlite-driver';

const columns: ColumnMetadata[] = [
  {
    name: 'id',
    dataType: 'INTEGER',
    nullable: false,
    isPrimaryKey: true,
    autoIncrement: true,
    defaultValue: null,
  },
];

describe('SqliteDriver query-editor support', () => {
  const driver = new SqliteDriver({ get: () => undefined } as unknown as ConfigService);

  it('uses declared result-column types without a database round-trip', async () => {
    const query = vi.fn();

    await expect(driver.describeResultColumns(query, [
      { name: 'id', dataTypeID: 0, dataTypeName: 'INTEGER' },
      { name: 'computed', dataTypeID: 0 },
    ], ['id'])).resolves.toEqual([
      { name: 'id', dataType: 'INTEGER', nullable: true, isPrimaryKey: true, autoIncrement: false, defaultValue: null },
      { name: 'computed', dataType: 'unknown', nullable: true, isPrimaryKey: false, autoIncrement: false, defaultValue: null },
    ]);
    expect(query).not.toHaveBeenCalled();
  });

  it('formats EXPLAIN QUERY PLAN detail rows', () => {
    expect(driver.formatExplain([
      { id: 2, parent: 0, detail: 'SCAN users' },
      { id: 5, parent: 0, detail: 'USE TEMP B-TREE FOR ORDER BY' },
    ])).toBe('SCAN users\nUSE TEMP B-TREE FOR ORDER BY');
  });
});

describe('SqliteDriver DDL normalization', () => {
  const driver = new SqliteDriver({ get: () => undefined } as unknown as ConfigService);
  const ref = { namespace: 'main', name: 'widgets' };

  it('canonicalizes types against the SQLite descriptor and trims safe defaults', () => {
    expect(driver.normalizeCreateTable({
      schema: 'main',
      table: 'widgets',
      columns: [
        { name: 'id', type: ' integer ', nullable: false, isPrimaryKey: true },
        { name: 'created_at', type: 'text', nullable: true, isPrimaryKey: false, default: ' CURRENT_TIMESTAMP ' },
      ],
    })).toEqual({
      schema: 'main',
      table: 'widgets',
      columns: [
        { name: 'id', type: 'INTEGER', nullable: false, isPrimaryKey: true },
        { name: 'created_at', type: 'TEXT', nullable: true, isPrimaryKey: false, default: 'CURRENT_TIMESTAMP' },
      ],
    });
  });

  it('rejects types outside the SQLite descriptor', () => {
    expect(() => driver.normalizeCreateTable({
      schema: 'main',
      table: 'widgets',
      columns: [{ name: 'payload', type: 'jsonb', nullable: true, isPrimaryKey: false }],
    })).toThrow('Unsupported column type "jsonb". Allowed types: INTEGER, TEXT, REAL, BLOB, NUMERIC');
  });

  it('performs existence and primary-key checks for alter-table operations', () => {
    expect(() => driver.normalizeAlterTable(ref, { kind: 'dropColumn', column: 'missing' }, columns))
      .toThrow('Column "missing" does not exist');
    expect(() => driver.normalizeAlterTable(ref, { kind: 'dropColumn', column: 'id' }, columns))
      .toThrow('Cannot drop primary key column "id"');
  });

  it('accepts only btree as an index method and derives a name', () => {
    const request = { schema: 'main', table: 'widgets', columns: ['id'], unique: false, method: 'BTREE' };
    expect(driver.normalizeCreateIndex(request)).toEqual({
      request,
      name: 'widgets_id_idx',
      method: 'btree',
    });
  });

  it('rejects non-btree index methods', () => {
    expect(() => driver.normalizeCreateIndex({
      schema: 'main',
      table: 'widgets',
      columns: ['id'],
      unique: false,
      method: 'hash',
    })).toThrow('Unsupported index method "hash". Allowed: btree');
  });

  it('uses the same truncation rule for derived index names', () => {
    const table = 't'.repeat(40);
    const column = 'c'.repeat(40);
    const raw = `${table}_${column}_idx`;

    expect(driver.normalizeCreateIndex({
      schema: 'main',
      table,
      columns: [column],
      unique: false,
    }).name).toBe(`${raw.slice(0, 59)}_idx`);
  });
});
