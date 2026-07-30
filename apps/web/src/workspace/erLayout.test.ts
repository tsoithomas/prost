import { describe, expect, it } from 'vitest';
import type { SchemaForeignKey, TableMetadata } from '@prost/shared-types';
import { buildErGraph, edgePath, graphBounds, layoutErGraph, type ErNode } from './erLayout';

function column(name: string, opts: { pk?: boolean; type?: string } = {}) {
  return {
    name,
    dataType: opts.type ?? 'integer',
    nullable: !opts.pk,
    isPrimaryKey: opts.pk ?? false,
    autoIncrement: false,
    defaultValue: null,
  };
}

const TABLES: TableMetadata[] = [
  { schema: 'public', name: 'users', columns: [column('id', { pk: true }), column('email', { type: 'text' })] },
  {
    schema: 'public',
    name: 'orders',
    columns: [column('id', { pk: true }), column('user_id'), column('total', { type: 'numeric' })],
  },
  { schema: 'public', name: 'audit', columns: [column('id', { pk: true })] },
];

const FKS: SchemaForeignKey[] = [
  {
    constraintName: 'orders_user_id_fkey',
    table: 'orders',
    schema: 'public',
    columns: ['user_id'],
    referencedSchema: 'public',
    referencedTable: 'users',
    referencedColumns: ['id'],
    onDelete: 'CASCADE',
  },
];

function overlaps(a: ErNode, b: ErNode): boolean {
  return (
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
  );
}

describe('buildErGraph', () => {
  it('creates one node per table and one edge per foreign key', () => {
    const graph = buildErGraph(TABLES, FKS, 'public');
    expect(graph.nodes.map((n) => n.key)).toEqual(['public.users', 'public.orders', 'public.audit']);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({
      source: 'public.orders',
      target: 'public.users',
      constraintName: 'orders_user_id_fkey',
      pairs: [{ from: 'user_id', to: 'id' }],
      onDelete: 'CASCADE',
      selfReference: false,
    });
  });

  it('marks PK and FK columns, and keeps key columns as the default node body', () => {
    const graph = buildErGraph(TABLES, FKS, 'public');
    const orders = graph.nodes.find((n) => n.table === 'orders')!;
    expect(orders.columns).toHaveLength(3);
    expect(orders.keyColumns.map((c) => c.name)).toEqual(['id', 'user_id']);
    expect(orders.keyColumns[0]).toMatchObject({ isPrimaryKey: true, isForeignKey: false });
    expect(orders.keyColumns[1]).toMatchObject({ isPrimaryKey: false, isForeignKey: true });
  });

  it('collapses a composite foreign key into a single edge with ordered column pairs', () => {
    const tables: TableMetadata[] = [
      { schema: 'app', name: 'orders', columns: [column('id', { pk: true }), column('line', { pk: true })] },
      {
        schema: 'app',
        name: 'order_items',
        columns: [column('order_id'), column('line')],
      },
    ];
    const fks: SchemaForeignKey[] = [
      {
        constraintName: 'order_items_ibfk_1',
        table: 'order_items',
        schema: null, // MySQL/SQLite report no schema namespace
        columns: ['order_id', 'line'],
        referencedSchema: null,
        referencedTable: 'orders',
        referencedColumns: ['id', 'line'],
      },
    ];

    const graph = buildErGraph(tables, fks, 'app');
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]!.pairs).toEqual([
      { from: 'order_id', to: 'id' },
      { from: 'line', to: 'line' },
    ]);
    expect(graph.edges[0]!.source).toBe('app.order_items');
    expect(graph.edges[0]!.target).toBe('app.orders');
  });

  it('flags a self-referencing foreign key', () => {
    const tables: TableMetadata[] = [
      { schema: 'public', name: 'employees', columns: [column('id', { pk: true }), column('manager_id')] },
    ];
    const fks: SchemaForeignKey[] = [
      {
        constraintName: 'employees_manager_fkey',
        table: 'employees',
        schema: 'public',
        columns: ['manager_id'],
        referencedSchema: 'public',
        referencedTable: 'employees',
        referencedColumns: ['id'],
      },
    ];
    expect(buildErGraph(tables, fks, 'public').edges[0]!.selfReference).toBe(true);
  });

  it('drops foreign keys pointing outside the schema and counts them', () => {
    const fks: SchemaForeignKey[] = [
      ...FKS,
      {
        constraintName: 'orders_region_fkey',
        table: 'orders',
        schema: 'public',
        columns: ['region_id'],
        referencedSchema: 'reference',
        referencedTable: 'regions',
        referencedColumns: ['id'],
      },
    ];
    const graph = buildErGraph(TABLES, fks, 'public');
    expect(graph.edges).toHaveLength(1);
    expect(graph.droppedEdges).toBe(1);
  });

  it('gives distinct ids to same-named constraints on different tables', () => {
    const tables: TableMetadata[] = [
      { schema: 'main', name: 'users', columns: [column('id', { pk: true })] },
      { schema: 'main', name: 'orders', columns: [column('user_id')] },
      { schema: 'main', name: 'carts', columns: [column('user_id')] },
    ];
    const fk = (table: string): SchemaForeignKey => ({
      constraintName: 'fk_0',
      table,
      schema: null,
      columns: ['user_id'],
      referencedSchema: null,
      referencedTable: 'users',
      referencedColumns: ['id'],
    });
    const graph = buildErGraph(tables, [fk('orders'), fk('carts')], 'main');
    expect(new Set(graph.edges.map((e) => e.id)).size).toBe(2);
  });
});

describe('layoutErGraph', () => {
  it('places related tables in successive columns and never overlaps nodes', () => {
    const laid = layoutErGraph(buildErGraph(TABLES, FKS, 'public'));
    const users = laid.nodes.find((n) => n.table === 'users')!;
    const orders = laid.nodes.find((n) => n.table === 'orders')!;

    // `users` is the most-referenced table, so it roots the component; `orders` sits one column out.
    expect(users.x).toBeLessThan(orders.x);
    for (const a of laid.nodes) {
      for (const b of laid.nodes) {
        if (a.key !== b.key) expect(overlaps(a, b)).toBe(false);
      }
    }
  });

  it('places tables with no relationships too', () => {
    const laid = layoutErGraph(buildErGraph(TABLES, FKS, 'public'));
    const audit = laid.nodes.find((n) => n.table === 'audit')!;
    expect(audit.width).toBeGreaterThan(0);
    expect(audit.height).toBeGreaterThan(0);
    // Disconnected components stack below the related ones.
    expect(audit.y).toBeGreaterThan(0);
  });

  it('is deterministic for the same input', () => {
    const a = layoutErGraph(buildErGraph(TABLES, FKS, 'public'));
    const b = layoutErGraph(buildErGraph(TABLES, FKS, 'public'));
    expect(a.nodes).toEqual(b.nodes);
  });

  it('grows nodes when every column is shown', () => {
    const graph = buildErGraph(TABLES, FKS, 'public');
    const keysOnly = layoutErGraph(graph).nodes.find((n) => n.table === 'orders')!;
    const allColumns = layoutErGraph(graph, { showAllColumns: true }).nodes.find((n) => n.table === 'orders')!;
    expect(allColumns.height).toBeGreaterThan(keysOnly.height);
  });

  it('handles an empty schema', () => {
    const laid = layoutErGraph(buildErGraph([], [], 'public'));
    expect(laid.nodes).toEqual([]);
    expect(graphBounds(laid.nodes)).toEqual({ width: 0, height: 0 });
  });
});

describe('edgePath', () => {
  const node = (key: string, x: number, y: number): ErNode => ({
    key,
    schema: 'public',
    table: key,
    columns: [],
    keyColumns: [],
    x,
    y,
    width: 100,
    height: 40,
  });

  it('leaves the right side of the left-hand node and enters the left of the right-hand one', () => {
    const d = edgePath(node('a', 0, 0), node('b', 300, 0));
    expect(d.startsWith('M 100 20')).toBe(true);
    expect(d).toContain('300 20');
  });

  it('draws a loop for a self-reference', () => {
    const a = node('a', 0, 0);
    const d = edgePath(a, a);
    expect(d).toContain('C');
    // Both ends sit on the same (right) side of the node.
    expect(d.startsWith('M 100')).toBe(true);
    expect(d.trimEnd().endsWith('100 28')).toBe(true);
  });
});
