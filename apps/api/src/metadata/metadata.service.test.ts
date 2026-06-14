import { describe, expect, it, vi } from 'vitest';
import type { ParameterizedResult } from '../target-db/pg-connection.service';
import type { PgConnectionService } from '../target-db/pg-connection.service';
import { MetadataService } from './metadata.service';

function result<T>(rows: T[]): ParameterizedResult<T extends Record<string, unknown> ? T : never> {
  return { rows: rows as never, fields: [], rowCount: rows.length, command: 'SELECT' };
}

function createService(runParameterized = vi.fn()) {
  const pgConnectionService = { runParameterized } as unknown as PgConnectionService;
  return { service: new MetadataService(pgConnectionService), runParameterized };
}

describe('MetadataService.getSchemas', () => {
  it('runs two queries in parallel and returns tables with columns', async () => {
    const runParameterized = vi.fn()
      .mockResolvedValueOnce(result([
        { table_schema: 'public', table_name: 'users' },
        { table_schema: 'public', table_name: 'orders' },
      ]))
      .mockResolvedValueOnce(result([
        { table_schema: 'public', table_name: 'users', column_name: 'id', data_type: 'integer', is_nullable: 'NO', is_primary_key: true },
        { table_schema: 'public', table_name: 'users', column_name: 'email', data_type: 'character varying', is_nullable: 'NO', is_primary_key: false },
        { table_schema: 'public', table_name: 'orders', column_name: 'id', data_type: 'integer', is_nullable: 'NO', is_primary_key: true },
      ]));
    const { service } = createService(runParameterized);

    const schemas = await service.getSchemas('conn-1');

    expect(runParameterized).toHaveBeenCalledTimes(2);
    expect(schemas).toHaveLength(1);
    expect(schemas[0]!.name).toBe('public');

    const [usersTable, ordersTable] = schemas[0]!.tables;
    expect(usersTable!.name).toBe('users');
    expect(usersTable!.columns).toHaveLength(2);
    expect(usersTable!.columns[0]).toEqual({ name: 'id', dataType: 'integer', nullable: false, isPrimaryKey: true });
    expect(usersTable!.columns[1]).toEqual({ name: 'email', dataType: 'character varying', nullable: false, isPrimaryKey: false });

    expect(ordersTable!.name).toBe('orders');
    expect(ordersTable!.columns).toHaveLength(1);
    expect(ordersTable!.columns[0]).toEqual({ name: 'id', dataType: 'integer', nullable: false, isPrimaryKey: true });
  });

  it('returns empty columns array for tables with no matching column rows', async () => {
    const runParameterized = vi.fn()
      .mockResolvedValueOnce(result([{ table_schema: 'public', table_name: 'empty_table' }]))
      .mockResolvedValueOnce(result([]));
    const { service } = createService(runParameterized);

    const schemas = await service.getSchemas('conn-1');
    expect(schemas[0]!.tables[0]!.columns).toEqual([]);
  });
});

describe('MetadataService.getTableIndexes', () => {
  it('binds schema and table as $1/$2 params — never interpolates them into the SQL', async () => {
    const runParameterized = vi.fn().mockResolvedValue(result([]));
    const { service } = createService(runParameterized);

    await service.getTableIndexes('conn-1', 'public', 'orders');

    const [connectionId, sql, params] = runParameterized.mock.calls[0] as [string, string, unknown[]];
    expect(connectionId).toBe('conn-1');
    expect(sql).not.toContain('public');
    expect(sql).not.toContain('orders');
    expect(sql).toContain('$1');
    expect(sql).toContain('$2');
    expect(params).toEqual(['public', 'orders']);
  });

  it('maps snake_case result columns to camelCase IndexMetadata', async () => {
    const runParameterized = vi.fn().mockResolvedValue(
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
    const { service } = createService(runParameterized);

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

describe('MetadataService.getTableStructure', () => {
  it('calls getTableColumns and getTableIndexes exactly once each and merges their results', async () => {
    const { service } = createService();
    const colsSpy = vi.spyOn(service, 'getTableColumns').mockResolvedValue([
      { name: 'id', dataType: 'integer', nullable: false, isPrimaryKey: true },
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
