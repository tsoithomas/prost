import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { PgDriver } from '../database/drivers/pg/pg-driver';
import type { PoolManager } from '../database/pool-manager.service';
import { MetadataService } from './metadata.service';

function result<T>(rows: T[]) {
  return { rows, fields: [], rowCount: rows.length, command: 'SELECT' };
}

function createService(run = vi.fn()) {
  const configStub = { get: () => undefined } as unknown as ConfigService;
  const driver = new PgDriver(configStub);
  const pool = { run, driverFor: vi.fn().mockResolvedValue(driver) } as unknown as PoolManager;
  return { service: new MetadataService(pool), run };
}

describe('MetadataService.getSchemas', () => {
  it('runs three queries in parallel and returns tables with columns + objects', async () => {
    const run = vi.fn()
      .mockResolvedValueOnce(result([
        { table_schema: 'public', table_name: 'users' },
        { table_schema: 'public', table_name: 'orders' },
      ]))
      .mockResolvedValueOnce(result([
        {
          table_schema: 'public', table_name: 'users', column_name: 'id', data_type: 'integer',
          is_nullable: 'NO', is_primary_key: true, default_value: "nextval('users_id_seq'::regclass)", is_auto_increment: true,
        },
        {
          table_schema: 'public', table_name: 'users', column_name: 'email', data_type: 'character varying',
          is_nullable: 'NO', is_primary_key: false, default_value: null, is_auto_increment: false,
        },
        {
          table_schema: 'public', table_name: 'orders', column_name: 'id', data_type: 'integer',
          is_nullable: 'NO', is_primary_key: true, default_value: 0, is_auto_increment: 0,
        },
      ]))
      .mockResolvedValueOnce(result([
        { kind: 'view', schema: 'public', name: 'active_users', comment: 'live users' },
        { kind: 'function', schema: 'public', name: 'add', comment: null },
      ]));
    const { service } = createService(run);

    const schemas = await service.getSchemas('conn-1');

    expect(run).toHaveBeenCalledTimes(3);
    expect(schemas).toHaveLength(1);
    expect(schemas[0]!.name).toBe('public');
    expect(schemas[0]!.objects).toEqual([
      { kind: 'view', schema: 'public', name: 'active_users', comment: 'live users' },
      { kind: 'function', schema: 'public', name: 'add' },
    ]);

    const [usersTable, ordersTable] = schemas[0]!.tables;
    expect(usersTable!.name).toBe('users');
    expect(usersTable!.columns).toHaveLength(2);
    expect(usersTable!.columns[0]).toEqual({
      name: 'id',
      dataType: 'integer',
      nullable: false,
      isPrimaryKey: true,
      autoIncrement: true,
      defaultValue: "nextval('users_id_seq'::regclass)",
    });
    expect(usersTable!.columns[1]).toEqual({
      name: 'email',
      dataType: 'character varying',
      nullable: false,
      isPrimaryKey: false,
      autoIncrement: false,
      defaultValue: null,
    });

    expect(ordersTable!.name).toBe('orders');
    expect(ordersTable!.columns).toHaveLength(1);
    expect(ordersTable!.columns[0]).toEqual({
      name: 'id',
      dataType: 'integer',
      nullable: false,
      isPrimaryKey: true,
      autoIncrement: false,
      defaultValue: '0',
    });
  });

  it('returns empty columns array for tables with no matching column rows', async () => {
    const run = vi.fn()
      .mockResolvedValueOnce(result([{ table_schema: 'public', table_name: 'empty_table' }]))
      .mockResolvedValueOnce(result([]))
      .mockResolvedValueOnce(result([]));
    const { service } = createService(run);

    const schemas = await service.getSchemas('conn-1');
    expect(schemas[0]!.tables[0]!.columns).toEqual([]);
    expect(schemas[0]!.objects).toEqual([]);
  });

  it('surfaces a schema that holds only objects (no tables)', async () => {
    const run = vi.fn()
      .mockResolvedValueOnce(result([]))
      .mockResolvedValueOnce(result([]))
      .mockResolvedValueOnce(result([{ kind: 'view', schema: 'reporting', name: 'daily', comment: null }]));
    const { service } = createService(run);

    const schemas = await service.getSchemas('conn-1');
    expect(schemas.map((s) => s.name)).toContain('reporting');
    expect(schemas.find((s) => s.name === 'reporting')!.objects).toHaveLength(1);
  });
});

describe('MetadataService.getObjectDefinition', () => {
  it('maps definition + normalizes a real-object extra (PG json), dropping nulls', async () => {
    const run = vi.fn().mockResolvedValue(
      result([{ definition: 'CREATE VIEW …', extra: { language: 'sql', returns: null } }]),
    );
    const { service } = createService(run);

    const detail = await service.getObjectDefinition('conn-1', 'public', 'function', 'add');
    expect(detail).toEqual({
      kind: 'function',
      schema: 'public',
      name: 'add',
      definition: 'CREATE VIEW …',
      extra: { language: 'sql' },
    });
  });

  it('parses a JSON-string extra (MySQL/SQLite) into a flat record', async () => {
    const run = vi.fn().mockResolvedValue(
      result([{ definition: 'BEGIN … END', extra: '{"timing":"BEFORE","event":"INSERT"}' }]),
    );
    const { service } = createService(run);

    const detail = await service.getObjectDefinition('conn-1', 'app', 'trigger', 'trg');
    expect(detail.extra).toEqual({ timing: 'BEFORE', event: 'INSERT' });
  });

  it('binds schema and object name as params, never interpolating them', async () => {
    const run = vi.fn().mockResolvedValue(result([{ definition: 'x', extra: null }]));
    const { service } = createService(run);

    await service.getObjectDefinition('conn-1', 'public', 'view', 'v');
    const [, frag] = run.mock.calls[0] as [string, { sql: string; params: unknown[] }];
    expect(frag.params).toEqual(['public', 'v']);
  });

  it('omits definition/extra when the object is not found', async () => {
    const run = vi.fn().mockResolvedValue(result([]));
    const { service } = createService(run);

    const detail = await service.getObjectDefinition('conn-1', 'public', 'view', 'missing');
    expect(detail).toEqual({ kind: 'view', schema: 'public', name: 'missing' });
  });
});

describe('MetadataService.getTableColumns', () => {
  it('maps default values and SQLite numeric auto-increment flags', async () => {
    const run = vi.fn().mockResolvedValue(result([
      {
        column_name: 'id', data_type: 'INTEGER', is_nullable: 'NO', is_primary_key: 1,
        default_value: null, is_auto_increment: 1,
      },
      {
        column_name: 'name', data_type: 'TEXT', is_nullable: 'YES', is_primary_key: 0,
        default_value: "''", is_auto_increment: 0,
      },
    ]));
    const { service } = createService(run);

    await expect(service.getTableColumns('conn-1', 'main', 'widgets')).resolves.toEqual([
      {
        name: 'id', dataType: 'INTEGER', nullable: false, isPrimaryKey: true,
        autoIncrement: true, defaultValue: null,
      },
      {
        name: 'name', dataType: 'TEXT', nullable: true, isPrimaryKey: false,
        autoIncrement: false, defaultValue: "''",
      },
    ]);
  });
});

describe('MetadataService.getTableIndexes', () => {
  it('binds schema and table as $1/$2 params — never interpolates them into the SQL', async () => {
    const run = vi.fn().mockResolvedValue(result([]));
    const { service } = createService(run);

    await service.getTableIndexes('conn-1', 'public', 'orders');

    const [connectionId, frag] = run.mock.calls[0] as [string, { sql: string; params: unknown[] }];
    expect(connectionId).toBe('conn-1');
    expect(frag.sql).not.toContain("'public'");
    expect(frag.sql).not.toContain("'orders'");
    expect(frag.sql).toContain('$1');
    expect(frag.sql).toContain('$2');
    expect(frag.params).toEqual(['public', 'orders']);
  });

  it('maps snake_case result columns to camelCase IndexMetadata', async () => {
    const run = vi.fn().mockResolvedValue(
      result([
        {
          name: 'orders_pkey',
          is_unique: true,
          is_primary: true,
          method: 'btree',
          definition: 'CREATE UNIQUE INDEX orders_pkey ON public.orders USING btree (id)',
          columns: ['id'],
        },
        {
          name: 'orders_user_id_idx',
          is_unique: false,
          is_primary: false,
          method: 'btree',
          definition: 'CREATE INDEX orders_user_id_idx ON public.orders USING btree (user_id)',
          columns: ['user_id'],
        },
      ]),
    );
    const { service } = createService(run);

    const indexes = await service.getTableIndexes('conn-1', 'public', 'orders');

    expect(indexes).toHaveLength(2);
    expect(indexes[0]).toEqual({
      name: 'orders_pkey',
      isUnique: true,
      isPrimary: true,
      method: 'btree',
      definition: 'CREATE UNIQUE INDEX orders_pkey ON public.orders USING btree (id)',
      columns: ['id'],
    });
    expect(indexes[1]).toEqual({
      name: 'orders_user_id_idx',
      isUnique: false,
      isPrimary: false,
      method: 'btree',
      definition: 'CREATE INDEX orders_user_id_idx ON public.orders USING btree (user_id)',
      columns: ['user_id'],
    });
  });
});

describe('MetadataService.getTableForeignKeys', () => {
  it('binds schema and table as params and never interpolates them', async () => {
    const run = vi.fn().mockResolvedValue(result([]));
    const { service } = createService(run);

    await service.getTableForeignKeys('conn-1', 'public', 'orders');

    const [connectionId, frag] = run.mock.calls[0] as [string, { sql: string; params: unknown[] }];
    expect(connectionId).toBe('conn-1');
    expect(frag.sql).not.toContain("'public'");
    expect(frag.sql).not.toContain("'orders'");
    expect(frag.params).toEqual(['public', 'orders']);
  });

  it('maps snake_case rows to ForeignKeyMetadata, normalizing array/JSON columns and null actions', async () => {
    const run = vi.fn().mockResolvedValue(
      result([
        {
          constraint_name: 'orders_user_id_fkey',
          columns: ['user_id'], // PG: real array
          referenced_schema: 'public',
          referenced_table: 'users',
          referenced_columns: ['id'],
          on_delete: 'CASCADE',
          on_update: 'NO ACTION',
        },
        {
          constraint_name: 'order_items_order_fk',
          columns: '["order_id","item_id"]', // MySQL/SQLite: JSON-encoded string
          referenced_schema: null,
          referenced_table: 'orders',
          referenced_columns: '["id","line"]',
          on_delete: null,
          on_update: null,
        },
      ]),
    );
    const { service } = createService(run);

    const fks = await service.getTableForeignKeys('conn-1', 'public', 'orders');

    expect(fks[0]).toEqual({
      constraintName: 'orders_user_id_fkey',
      columns: ['user_id'],
      referencedSchema: 'public',
      referencedTable: 'users',
      referencedColumns: ['id'],
      onDelete: 'CASCADE',
      onUpdate: 'NO ACTION',
    });
    // Composite FK: JSON-encoded arrays parse to ordered column pairs; null actions → undefined.
    expect(fks[1]).toEqual({
      constraintName: 'order_items_order_fk',
      columns: ['order_id', 'item_id'],
      referencedSchema: null,
      referencedTable: 'orders',
      referencedColumns: ['id', 'line'],
      onDelete: undefined,
      onUpdate: undefined,
    });
  });
});

describe('MetadataService.getReferencingForeignKeys', () => {
  it('maps rows to ReferencingKeyMetadata including the child table and schema', async () => {
    const run = vi.fn().mockResolvedValue(
      result([
        {
          constraint_name: 'orders_user_id_fkey',
          table_schema: 'public',
          table_name: 'orders',
          columns: ['user_id'],
          referenced_schema: 'public',
          referenced_table: 'users',
          referenced_columns: ['id'],
          on_delete: 'CASCADE',
          on_update: null,
        },
      ]),
    );
    const { service } = createService(run);

    const refs = await service.getReferencingForeignKeys('conn-1', 'public', 'users');
    expect(refs[0]).toEqual({
      constraintName: 'orders_user_id_fkey',
      table: 'orders',
      schema: 'public',
      columns: ['user_id'],
      referencedSchema: 'public',
      referencedTable: 'users',
      referencedColumns: ['id'],
      onDelete: 'CASCADE',
      onUpdate: undefined,
    });
  });
});

describe('MetadataService.getSchemaOverview', () => {
  it('binds the schema, maps stat rows to TableOverview, and sums non-null totals', async () => {
    const run = vi.fn().mockResolvedValue(
      result([
        {
          table_name: 'users', row_estimate: '120', size_bytes: '8192', column_count: '5',
          index_count: '2', engine: null, collation: null, comment: 'app users',
        },
        {
          table_name: 'orders', row_estimate: 40, size_bytes: 4096, column_count: 3,
          index_count: 1, engine: null, collation: null, comment: null,
        },
      ]),
    );
    const { service } = createService(run);

    const overview = await service.getSchemaOverview('conn-1', 'public');

    const [connectionId, frag] = run.mock.calls[0] as [string, { sql: string; params: unknown[] }];
    expect(connectionId).toBe('conn-1');
    expect(frag.params).toEqual(['public']);

    expect(overview.schema).toBe('public');
    expect(overview.tables).toHaveLength(2);
    expect(overview.tables[0]).toEqual({
      schema: 'public', name: 'users', rowEstimate: 120, sizeBytes: 8192,
      columnCount: 5, indexCount: 2, engine: null, collation: null, comment: 'app users',
    });
    expect(overview.totalRowEstimate).toBe(160);
    expect(overview.totalSizeBytes).toBe(12288);
  });

  it('keeps null row/size totals when the engine provides none (SQLite)', async () => {
    const run = vi.fn().mockResolvedValue(
      result([
        {
          table_name: 't1', row_estimate: null, size_bytes: null, column_count: 4,
          index_count: 0, engine: null, collation: null, comment: null,
        },
      ]),
    );
    const { service } = createService(run);

    const overview = await service.getSchemaOverview('conn-1', 'main');
    expect(overview.tables[0]!.rowEstimate).toBeNull();
    expect(overview.tables[0]!.sizeBytes).toBeNull();
    expect(overview.tables[0]!.columnCount).toBe(4);
    expect(overview.totalRowEstimate).toBeNull();
    expect(overview.totalSizeBytes).toBeNull();
  });
});

describe('MetadataService.getTableStructure', () => {
  it('calls getTableColumns, getTableIndexes and getTableForeignKeys once each and merges their results', async () => {
    const { service } = createService();
    const colsSpy = vi.spyOn(service, 'getTableColumns').mockResolvedValue([
      { name: 'id', dataType: 'integer', nullable: false, isPrimaryKey: true, autoIncrement: false, defaultValue: null },
    ]);
    const idxSpy = vi.spyOn(service, 'getTableIndexes').mockResolvedValue([]);
    const fkSpy = vi.spyOn(service, 'getTableForeignKeys').mockResolvedValue([
      {
        constraintName: 'orders_user_id_fkey', columns: ['user_id'], referencedSchema: 'public',
        referencedTable: 'users', referencedColumns: ['id'], onDelete: 'CASCADE', onUpdate: 'NO ACTION',
      },
    ]);

    const structure = await service.getTableStructure('conn-1', 'public', 'orders');

    expect(colsSpy).toHaveBeenCalledOnce();
    expect(colsSpy).toHaveBeenCalledWith('conn-1', 'public', 'orders');
    expect(idxSpy).toHaveBeenCalledOnce();
    expect(idxSpy).toHaveBeenCalledWith('conn-1', 'public', 'orders');
    expect(fkSpy).toHaveBeenCalledOnce();
    expect(fkSpy).toHaveBeenCalledWith('conn-1', 'public', 'orders');
    expect(structure.columns).toHaveLength(1);
    expect(structure.indexes).toHaveLength(0);
    expect(structure.foreignKeys).toHaveLength(1);
  });
});
