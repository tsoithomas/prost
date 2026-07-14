import { UnprocessableEntityException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { ColumnMetadata } from '@prost/shared-types';
import { buildAddForeignKeyClause, normalizeAddForeignKey, normalizeDropForeignKey, type AddForeignKeyOp } from './fk-ddl';

const cols: ColumnMetadata[] = [
  { name: 'id', dataType: 'integer', nullable: false, isPrimaryKey: true, autoIncrement: false, defaultValue: null },
  { name: 'user_id', dataType: 'integer', nullable: true, isPrimaryKey: false, autoIncrement: false, defaultValue: null },
  { name: 'product_id', dataType: 'integer', nullable: true, isPrimaryKey: false, autoIncrement: false, defaultValue: null },
];

const ref = { namespace: 'public', name: 'orders' };

function op(overrides: Partial<AddForeignKeyOp> = {}): AddForeignKeyOp {
  return {
    kind: 'addForeignKey',
    columns: ['user_id'],
    referencedSchema: 'public',
    referencedTable: 'users',
    referencedColumns: ['id'],
    ...overrides,
  };
}

describe('normalizeAddForeignKey', () => {
  it('synthesizes a constraint name from table + columns when omitted', () => {
    expect(normalizeAddForeignKey(ref, op(), cols).constraintName).toBe('orders_user_id_fkey');
  });

  it('preserves an explicit constraint name', () => {
    expect(normalizeAddForeignKey(ref, op({ constraintName: 'my_fk' }), cols).constraintName).toBe('my_fk');
  });

  it('rejects a local column that does not exist', () => {
    expect(() => normalizeAddForeignKey(ref, op({ columns: ['ghost'] }), cols)).toThrow(UnprocessableEntityException);
  });

  it('rejects a local/referenced column count mismatch', () => {
    expect(() =>
      normalizeAddForeignKey(ref, op({ columns: ['user_id', 'product_id'], referencedColumns: ['id'] }), cols),
    ).toThrow(/counts must match/);
  });

  it('rejects an empty column list and an invalid action', () => {
    expect(() => normalizeAddForeignKey(ref, op({ columns: [], referencedColumns: [] }), cols)).toThrow(/at least one column/);
    expect(() => normalizeAddForeignKey(ref, op({ onDelete: 'BOOM' as never }), cols)).toThrow(/Invalid ON DELETE/);
  });
});

describe('normalizeDropForeignKey', () => {
  it('rejects an empty constraint name', () => {
    expect(() => normalizeDropForeignKey({ kind: 'dropForeignKey', constraintName: '' })).toThrow(UnprocessableEntityException);
  });
  it('accepts a non-empty name', () => {
    expect(() => normalizeDropForeignKey({ kind: 'dropForeignKey', constraintName: 'fk' })).not.toThrow();
  });
});

describe('buildAddForeignKeyClause', () => {
  const q = (id: string) => `"${id}"`;
  const qualify = (r: { namespace?: string; name: string }) => (r.namespace ? `"${r.namespace}"."${r.name}"` : `"${r.name}"`);

  it('emits actions only when present and qualifies the referenced table', () => {
    const normalized = normalizeAddForeignKey(ref, op({ constraintName: 'fk', onDelete: 'CASCADE' }), cols);
    expect(buildAddForeignKeyClause(normalized, q, qualify).sql).toBe(
      'ADD CONSTRAINT "fk" FOREIGN KEY ("user_id") REFERENCES "public"."users" ("id") ON DELETE CASCADE',
    );
  });

  it('omits the schema qualifier when referencedSchema is null', () => {
    const normalized = normalizeAddForeignKey(ref, op({ constraintName: 'fk', referencedSchema: null }), cols);
    expect(buildAddForeignKeyClause(normalized, q, qualify).sql).toBe(
      'ADD CONSTRAINT "fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id")',
    );
  });
});
