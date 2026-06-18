import type { ConfigService } from '@nestjs/config';
import type { ColumnMetadata } from '@prost/shared-types';
import { describe, expect, it, vi } from 'vitest';
import { PgDriver } from './pg-driver';

const columns: ColumnMetadata[] = [
  {
    name: 'id',
    dataType: 'integer',
    nullable: false,
    isPrimaryKey: true,
    autoIncrement: false,
    defaultValue: null,
  },
  {
    name: 'note',
    dataType: 'text',
    nullable: true,
    isPrimaryKey: false,
    autoIncrement: false,
    defaultValue: null,
  },
];

describe('PgDriver query-editor support', () => {
  const driver = new PgDriver({ get: () => undefined } as unknown as ConfigService);

  it('resolves missing result-column type names through pg_type', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ oid: 23, typname: 'int4' }, { oid: 1043, typname: 'varchar' }],
      fields: [],
      rowCount: 2,
      command: 'SELECT',
    });

    await expect(driver.describeResultColumns(query, [
      { name: 'id', dataTypeID: 23 },
      { name: 'email', dataTypeID: 1043, dataTypeName: 'text' },
    ], ['id'])).resolves.toEqual([
      { name: 'id', dataType: 'int4', nullable: true, isPrimaryKey: true, autoIncrement: false, defaultValue: null },
      { name: 'email', dataType: 'text', nullable: true, isPrimaryKey: false, autoIncrement: false, defaultValue: null },
    ]);
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]![0].sql).toContain('pg_type');
    expect(query.mock.calls[0]![0].params).toEqual([[23, 1043]]);
  });

  it('keeps PostgreSQL EXPLAIN output byte-for-byte identical', () => {
    expect(driver.formatExplain([
      { 'QUERY PLAN': 'Seq Scan on users  (cost=0.00..1.05 rows=5 width=40)' },
      { 'QUERY PLAN': '  Filter: (id > 1)' },
    ])).toBe('Seq Scan on users  (cost=0.00..1.05 rows=5 width=40)\n  Filter: (id > 1)');
  });
});

describe('PgDriver DDL normalization', () => {
  const driver = new PgDriver({ get: () => undefined } as unknown as ConfigService);
  const ref = { namespace: 'public', name: 'users' };

  it('canonicalizes create-table types and safe defaults', () => {
    expect(driver.normalizeCreateTable({
      schema: 'public',
      table: 'widgets',
      columns: [
        { name: 'label', type: ' VARCHAR( 255 ) ', nullable: true, isPrimaryKey: false, default: '' },
        { name: 'created_at', type: ' TimestampTz ', nullable: false, isPrimaryKey: false, default: ' NOW() ' },
      ],
    })).toEqual({
      schema: 'public',
      table: 'widgets',
      columns: [
        { name: 'label', type: 'varchar(255)', nullable: true, isPrimaryKey: false },
        { name: 'created_at', type: 'timestamptz', nullable: false, isPrimaryKey: false, default: 'now()' },
      ],
    });
  });

  it('rejects unsupported column types with the current DdlService message', () => {
    expect(() => driver.normalizeCreateTable({
      schema: 'public',
      table: 'widgets',
      columns: [{ name: 'payload', type: 'xml', nullable: true, isPrimaryKey: false }],
    })).toThrow(
      'Unsupported column type "xml". Allowed types: integer, bigint, smallint, serial, bigserial, boolean, text, varchar, char, real, double precision, numeric, date, time, timestamp, timestamptz, uuid, json, jsonb, bytea',
    );
  });

  it('rejects parameters on non-parameterized types with the current DdlService message', () => {
    expect(() => driver.normalizeCreateTable({
      schema: 'public',
      table: 'widgets',
      columns: [{ name: 'count', type: 'integer(10)', nullable: true, isPrimaryKey: false }],
    })).toThrow('Type "integer" does not accept a length/precision parameter');
  });

  it('rejects unsafe defaults with the current DdlService message', () => {
    expect(() => driver.normalizeCreateTable({
      schema: 'public',
      table: 'widgets',
      columns: [{ name: 'payload', type: 'text', nullable: true, isPrimaryKey: false, default: "'unsafe'" }],
    })).toThrow(
      'Unsupported default value "\'unsafe\'". Allowed: now(), current_timestamp, gen_random_uuid(), true, false, null, or a non-negative integer',
    );
  });

  it('rejects adding an existing column with the current DdlService message', () => {
    expect(() => driver.normalizeAlterTable(ref, {
      kind: 'addColumn',
      column: { name: 'note', type: 'text', nullable: true, isPrimaryKey: false },
    }, columns)).toThrow('Column "note" already exists');
  });

  it('forces primary-key additions to be non-nullable', () => {
    expect(driver.normalizeAlterTable(ref, {
      kind: 'addColumn',
      column: { name: 'external_id', type: ' UUID ', nullable: true, isPrimaryKey: true, default: ' GEN_RANDOM_UUID() ' },
    }, columns)).toEqual({
      kind: 'addColumn',
      column: {
        name: 'external_id',
        type: 'uuid',
        nullable: false,
        isPrimaryKey: true,
        default: 'gen_random_uuid()',
      },
    });
  });

  it('rejects dropping a primary-key column with the current DdlService message', () => {
    expect(() => driver.normalizeAlterTable(ref, { kind: 'dropColumn', column: 'id' }, columns))
      .toThrow('Cannot drop primary key column "id"');
  });

  it('canonicalizes a valid USING expression', () => {
    expect(driver.normalizeAlterTable(ref, {
      kind: 'changeType',
      column: 'note',
      type: ' VARCHAR( 64 ) ',
      using: ' NOTE::VARCHAR( 64 ) ',
    }, columns)).toEqual({
      kind: 'changeType',
      column: 'note',
      type: 'varchar(64)',
      using: 'note::varchar( 64 )',
    });
  });

  it('rejects unsafe USING expressions with the current DdlService message', () => {
    expect(() => driver.normalizeAlterTable(ref, {
      kind: 'changeType',
      column: 'note',
      type: 'integer',
      using: 'note; DROP TABLE users',
    }, columns)).toThrow(
      'Unsupported USING expression "note; DROP TABLE users". Allowed: identifier or identifier::type',
    );
  });

  it('rejects empty set-default values with the current DdlService message', () => {
    expect(() => driver.normalizeAlterTable(ref, {
      kind: 'setDefault',
      column: 'note',
      default: ' ',
    }, columns)).toThrow('Default value cannot be empty; pass null to drop the default');
  });

  it('normalizes index methods and derives index names', () => {
    const request = { schema: 'public', table: 'users', columns: ['note'], unique: false, method: 'GIN' };
    expect(driver.normalizeCreateIndex(request)).toEqual({
      request,
      name: 'users_note_idx',
      method: 'gin',
    });
  });

  it('rejects unsupported index methods with the current DdlService message', () => {
    expect(() => driver.normalizeCreateIndex({
      schema: 'public',
      table: 'users',
      columns: ['note'],
      unique: false,
      method: 'evil',
    })).toThrow('Unsupported index method "evil". Allowed: btree, hash, gin, gist, brin');
  });

  it('truncates derived index names to PostgreSQL identifier length', () => {
    const table = 't'.repeat(40);
    const column = 'c'.repeat(40);
    const raw = `${table}_${column}_idx`;

    expect(driver.normalizeCreateIndex({
      schema: 'public',
      table,
      columns: [column],
      unique: false,
    }).name).toBe(`${raw.slice(0, 59)}_idx`);
  });
});
