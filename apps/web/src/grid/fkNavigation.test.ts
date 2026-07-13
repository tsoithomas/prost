import { describe, expect, it } from 'vitest';
import type { ForeignKeyMetadata, ReferencingKeyMetadata } from '@prost/shared-types';
import { buildFkNavTargets } from './fkNavigation';

const usersFk: ForeignKeyMetadata = {
  constraintName: 'orders_user_id_fkey',
  columns: ['user_id'],
  referencedSchema: 'public',
  referencedTable: 'users',
  referencedColumns: ['id'],
};

const compositeFk: ForeignKeyMetadata = {
  constraintName: 'order_items_order_fk',
  columns: ['order_id', 'product_id'],
  referencedSchema: null,
  referencedTable: 'orders',
  referencedColumns: ['id', 'product'],
};

const ordersReferencing: ReferencingKeyMetadata = {
  constraintName: 'orders_user_id_fkey',
  table: 'orders',
  schema: 'public',
  columns: ['user_id'],
  referencedSchema: 'public',
  referencedTable: 'users',
  referencedColumns: ['id'],
};

describe('buildFkNavTargets — forward navigation', () => {
  it('builds an eq filter over the referenced columns bound to the clicked row values', () => {
    const targets = buildFkNavTargets('user_id', { user_id: 42, name: 'ada' }, [usersFk], [], 'public');
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({
      direction: 'forward',
      schema: 'public',
      table: 'users',
      filter: { combinator: 'and', conditions: [{ column: 'id', operator: 'eq', value: 42 }] },
    });
  });

  it('only offers forward nav for the clicked column, not other FK columns in the row', () => {
    // Clicking a non-FK column yields no forward target.
    expect(buildFkNavTargets('name', { user_id: 42, name: 'ada' }, [usersFk], [], 'public')).toHaveLength(0);
  });

  it('falls back to the current schema when the engine has no schema namespace', () => {
    const [target] = buildFkNavTargets('order_id', { order_id: 1, product_id: 7 }, [compositeFk], [], 'demo');
    expect(target!.schema).toBe('demo');
  });

  it('builds a multi-condition filter for a composite FK', () => {
    const [target] = buildFkNavTargets('product_id', { order_id: 1, product_id: 7 }, [compositeFk], [], 'demo');
    expect(target!.filter.conditions).toEqual([
      { column: 'id', operator: 'eq', value: 1 },
      { column: 'product', operator: 'eq', value: 7 },
    ]);
  });

  it('hides the action when an FK column is absent from the projection', () => {
    // product_id missing from the row → composite nav cannot be built.
    expect(buildFkNavTargets('order_id', { order_id: 1 }, [compositeFk], [], 'demo')).toHaveLength(0);
  });

  it('hides the action when the FK value is null (nothing to open)', () => {
    expect(buildFkNavTargets('user_id', { user_id: null }, [usersFk], [], 'public')).toHaveLength(0);
  });
});

describe('buildFkNavTargets — reverse navigation', () => {
  it('builds the inverse filter on the child table from any cell in the row', () => {
    // Clicking any column (here the PK `id`) offers the row-level reverse action.
    const targets = buildFkNavTargets('id', { id: 42, name: 'ada' }, [], [ordersReferencing], 'public');
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({
      direction: 'reverse',
      schema: 'public',
      table: 'orders',
      filter: { combinator: 'and', conditions: [{ column: 'user_id', operator: 'eq', value: 42 }] },
    });
  });

  it('offers both directions when the clicked column is itself an FK and the row is referenced', () => {
    const selfRef: ReferencingKeyMetadata = { ...ordersReferencing, table: 'audit', referencedColumns: ['user_id'] };
    const targets = buildFkNavTargets('user_id', { user_id: 42 }, [usersFk], [selfRef], 'public');
    expect(targets.map((t) => t.direction)).toEqual(['forward', 'reverse']);
  });
});
