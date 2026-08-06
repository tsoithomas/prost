import { describe, expect, it } from 'vitest';
import type { ColumnMetadata, ForeignKeyMetadata, IndexMetadata, SchemaRef } from '@prost/shared-types';
import { buildMigrationCandidates, buildSchemaDiff, isDestructiveChange, type ResolvedTable } from './diff.util';

const LEFT: SchemaRef = { connectionId: 'left-conn', schema: 'public' };
const RIGHT: SchemaRef = { connectionId: 'right-conn', schema: 'public' };

function col(overrides: Partial<ColumnMetadata> & { name: string }): ColumnMetadata {
  return {
    dataType: 'text',
    nullable: true,
    isPrimaryKey: false,
    autoIncrement: false,
    defaultValue: null,
    ...overrides,
  };
}

function idx(overrides: Partial<IndexMetadata> & { name: string; columns: string[] }): IndexMetadata {
  return { isUnique: false, isPrimary: false, method: 'btree', definition: '', ...overrides };
}

function fk(overrides: Partial<ForeignKeyMetadata> & { constraintName: string }): ForeignKeyMetadata {
  return {
    columns: ['user_id'],
    referencedSchema: 'public',
    referencedTable: 'users',
    referencedColumns: ['id'],
    ...overrides,
  };
}

function table(name: string, columns: ColumnMetadata[], indexes: IndexMetadata[] = [], foreignKeys: ForeignKeyMetadata[] = []): ResolvedTable {
  return { name, columns, indexes, foreignKeys };
}

describe('buildSchemaDiff', () => {
  it('marks a table only on the right as added, and only on the left as removed', () => {
    const left = [table('users', [col({ name: 'id', isPrimaryKey: true, dataType: 'integer' })])];
    const right = [
      table('users', [col({ name: 'id', isPrimaryKey: true, dataType: 'integer' })]),
      table('orders', [col({ name: 'id', isPrimaryKey: true, dataType: 'integer' })]),
    ];

    const diff = buildSchemaDiff(LEFT, left, RIGHT, right);
    const users = diff.tables.find((t) => t.name === 'users')!;
    const orders = diff.tables.find((t) => t.name === 'orders')!;

    expect(users).toMatchObject({ status: 'unchanged', existsLeft: true, existsRight: true });
    expect(orders).toMatchObject({ status: 'added', existsLeft: false, existsRight: true });
  });

  it('marks a table changed when a column differs, and reports that column as changed', () => {
    const left = [table('users', [col({ name: 'id', dataType: 'integer' }), col({ name: 'age', dataType: 'integer' })])];
    const right = [table('users', [col({ name: 'id', dataType: 'integer' }), col({ name: 'age', dataType: 'bigint' })])];

    const diff = buildSchemaDiff(LEFT, left, RIGHT, right);
    const users = diff.tables[0]!;

    expect(users.status).toBe('changed');
    const ageDiff = users.columns.find((c) => c.name === 'age')!;
    expect(ageDiff.status).toBe('changed');
    expect(ageDiff.left?.dataType).toBe('integer');
    expect(ageDiff.right?.dataType).toBe('bigint');
  });

  it('diffs indexes and foreign keys by name/constraint', () => {
    const left = [
      table(
        'orders',
        [col({ name: 'id' }), col({ name: 'user_id' })],
        [idx({ name: 'orders_user_id_idx', columns: ['user_id'] })],
        [fk({ constraintName: 'orders_user_id_fkey' })],
      ),
    ];
    const right = [
      table(
        'orders',
        [col({ name: 'id' }), col({ name: 'user_id' })],
        [idx({ name: 'orders_user_id_idx', columns: ['user_id'], isUnique: true })],
        [],
      ),
    ];

    const diff = buildSchemaDiff(LEFT, left, RIGHT, right);
    const orders = diff.tables[0]!;

    expect(orders.indexes[0]).toMatchObject({ name: 'orders_user_id_idx', status: 'changed' });
    expect(orders.foreignKeys[0]).toMatchObject({ constraintName: 'orders_user_id_fkey', status: 'removed' });
    expect(orders.status).toBe('changed');
  });

  it('marks unchanged tables with no member diffs at all as unchanged', () => {
    const shape = [table('users', [col({ name: 'id', dataType: 'integer', isPrimaryKey: true })])];
    const diff = buildSchemaDiff(LEFT, shape, RIGHT, shape);
    expect(diff.tables[0]).toMatchObject({ status: 'unchanged' });
    expect(diff.tables[0]!.columns[0]!.status).toBe('unchanged');
  });
});

describe('buildMigrationCandidates', () => {
  it('creates a table on the target that only exists on the source side', () => {
    const left = [table('users', [col({ name: 'id', isPrimaryKey: true, dataType: 'integer' })])];
    const right = [
      table('users', [col({ name: 'id', isPrimaryKey: true, dataType: 'integer' })]),
      table('orders', [col({ name: 'id', isPrimaryKey: true, dataType: 'integer' }), col({ name: 'total', dataType: 'numeric' })]),
    ];
    const diff = buildSchemaDiff(LEFT, left, RIGHT, right);

    const changes = buildMigrationCandidates(diff, 'right');
    expect(changes).toEqual([
      {
        kind: 'createTable',
        request: {
          schema: 'public',
          table: 'orders',
          columns: [
            { name: 'id', type: 'integer', nullable: true, isPrimaryKey: true, autoIncrement: false },
            { name: 'total', type: 'numeric', nullable: true, isPrimaryKey: false, autoIncrement: false },
          ],
        },
      },
    ]);
  });

  it('drops a table on the target that the source side lacks', () => {
    const left = [table('users', [col({ name: 'id' })])];
    const right = [table('users', [col({ name: 'id' })]), table('legacy', [col({ name: 'id' })])];
    const diff = buildSchemaDiff(LEFT, left, RIGHT, right);

    const changes = buildMigrationCandidates(diff, 'left');
    expect(changes).toEqual([{ kind: 'dropTable', request: { schema: 'public', table: 'legacy' } }]);
  });

  it('emits addColumn/dropColumn depending on which side is authoritative', () => {
    const left = [table('users', [col({ name: 'id' }), col({ name: 'nickname' })])];
    const right = [table('users', [col({ name: 'id' })])];
    const diff = buildSchemaDiff(LEFT, left, RIGHT, right);

    const fromLeft = buildMigrationCandidates(diff, 'left');
    expect(fromLeft).toEqual([
      {
        kind: 'alterTable',
        request: {
          schema: 'public',
          table: 'users',
          operation: { kind: 'addColumn', column: { name: 'nickname', type: 'text', nullable: true, isPrimaryKey: false, autoIncrement: false } },
        },
      },
    ]);

    const fromRight = buildMigrationCandidates(diff, 'right');
    expect(fromRight).toEqual([
      {
        kind: 'alterTable',
        request: { schema: 'public', table: 'users', operation: { kind: 'dropColumn', column: 'nickname' } },
      },
    ]);
  });

  it('emits changeType targeting the source side value', () => {
    const left = [table('users', [col({ name: 'age', dataType: 'integer' })])];
    const right = [table('users', [col({ name: 'age', dataType: 'bigint' })])];
    const diff = buildSchemaDiff(LEFT, left, RIGHT, right);

    expect(buildMigrationCandidates(diff, 'left')).toEqual([
      {
        kind: 'alterTable',
        request: { schema: 'public', table: 'users', operation: { kind: 'changeType', column: 'age', type: 'integer' } },
      },
    ]);
  });

  it('reconciles a changed non-primary index as a drop then a create', () => {
    const left = [table('orders', [col({ name: 'id' })], [idx({ name: 'orders_idx', columns: ['id'] })])];
    const right = [table('orders', [col({ name: 'id' })], [idx({ name: 'orders_idx', columns: ['id'], isUnique: true })])];
    const diff = buildSchemaDiff(LEFT, left, RIGHT, right);

    expect(buildMigrationCandidates(diff, 'left')).toEqual([
      { kind: 'dropIndex', request: { schema: 'public', table: 'orders', index: 'orders_idx' } },
      { kind: 'createIndex', request: { schema: 'public', table: 'orders', name: 'orders_idx', columns: ['id'], unique: false, method: 'btree' } },
    ]);
  });

  it('never proposes createIndex/dropIndex for a primary-key index', () => {
    const left = [table('orders', [col({ name: 'id' })], [idx({ name: 'orders_pkey', columns: ['id'], isPrimary: true })])];
    const right = [table('orders', [col({ name: 'id' })], [])];
    const diff = buildSchemaDiff(LEFT, left, RIGHT, right);

    expect(buildMigrationCandidates(diff, 'left')).toEqual([]);
  });
});

describe('isDestructiveChange', () => {
  it('flags dropTable, dropIndex, dropColumn and dropForeignKey as destructive', () => {
    expect(isDestructiveChange({ kind: 'dropTable', request: { schema: 's', table: 't' } })).toBe(true);
    expect(isDestructiveChange({ kind: 'dropIndex', request: { schema: 's', table: 't', index: 'i' } })).toBe(true);
    expect(
      isDestructiveChange({
        kind: 'alterTable',
        request: { schema: 's', table: 't', operation: { kind: 'dropColumn', column: 'c' } },
      }),
    ).toBe(true);
    expect(
      isDestructiveChange({
        kind: 'alterTable',
        request: { schema: 's', table: 't', operation: { kind: 'dropForeignKey', constraintName: 'fk' } },
      }),
    ).toBe(true);
  });

  it('does not flag additive/in-place ops as destructive', () => {
    expect(
      isDestructiveChange({
        kind: 'alterTable',
        request: {
          schema: 's',
          table: 't',
          operation: { kind: 'addColumn', column: { name: 'c', type: 'text', nullable: true, isPrimaryKey: false } },
        },
      }),
    ).toBe(false);
    expect(isDestructiveChange({ kind: 'createIndex', request: { schema: 's', table: 't', columns: ['c'], unique: false } })).toBe(false);
    expect(isDestructiveChange({ kind: 'createTable', request: { schema: 's', table: 't', columns: [] } })).toBe(false);
  });
});
