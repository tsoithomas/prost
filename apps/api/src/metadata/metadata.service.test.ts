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
  it('runs two queries in parallel and returns tables with columns', async () => {
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
      ]));
    const { service } = createService(run);

    const schemas = await service.getSchemas('conn-1');

    expect(run).toHaveBeenCalledTimes(2);
    expect(schemas).toHaveLength(1);
    expect(schemas[0]!.name).toBe('public');

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
      .mockResolvedValueOnce(result([]));
    const { service } = createService(run);

    const schemas = await service.getSchemas('conn-1');
    expect(schemas[0]!.tables[0]!.columns).toEqual([]);
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
  it('calls getTableColumns and getTableIndexes exactly once each and merges their results', async () => {
    const { service } = createService();
    const colsSpy = vi.spyOn(service, 'getTableColumns').mockResolvedValue([
      { name: 'id', dataType: 'integer', nullable: false, isPrimaryKey: true, autoIncrement: false, defaultValue: null },
    ]);
    const idxSpy = vi.spyOn(service, 'getTableIndexes').mockResolvedValue([]);

    const structure = await service.getTableStructure('conn-1', 'public', 'orders');

    expect(colsSpy).toHaveBeenCalledOnce();
    expect(colsSpy).toHaveBeenCalledWith('conn-1', 'public', 'orders');
    expect(idxSpy).toHaveBeenCalledOnce();
    expect(idxSpy).toHaveBeenCalledWith('conn-1', 'public', 'orders');
    expect(structure.columns).toHaveLength(1);
    expect(structure.indexes).toHaveLength(0);
  });
});
