import { describe, expect, it } from 'vitest';
import {
  mysqlBuildExplain,
  mysqlParseExplain,
  pgBuildExplain,
  pgParseExplain,
  sqliteBuildExplain,
  sqliteParseExplain,
} from './explain-plan';

describe('explain-plan — PostgreSQL (FORMAT JSON)', () => {
  it('wraps the statement, adding ANALYZE only when asked', () => {
    expect(pgBuildExplain('SELECT 1', false).sql).toBe('EXPLAIN (FORMAT JSON) SELECT 1');
    expect(pgBuildExplain('SELECT 1', true).sql).toBe('EXPLAIN (FORMAT JSON, ANALYZE, BUFFERS) SELECT 1');
  });

  it('parses the JSON plan into a normalized tree', () => {
    const plan = [
      {
        Plan: {
          'Node Type': 'Hash Join',
          'Join Type': 'Inner',
          'Total Cost': 100.5,
          'Plan Rows': 200,
          Plans: [
            { 'Node Type': 'Seq Scan', 'Relation Name': 'orders', 'Total Cost': 50, 'Plan Rows': 100 },
            {
              'Node Type': 'Hash',
              'Total Cost': 25,
              'Plan Rows': 100,
              Plans: [{ 'Node Type': 'Seq Scan', 'Relation Name': 'users', 'Total Cost': 20, 'Plan Rows': 100 }],
            },
          ],
        },
      },
    ];

    const root = pgParseExplain([{ 'QUERY PLAN': plan }]);
    expect(root.nodeType).toBe('Hash Join');
    expect(root.detail).toBe('Inner');
    expect(root.estimatedCost).toBe(100.5);
    expect(root.estimatedRows).toBe(200);
    expect(root.children).toHaveLength(2);
    expect(root.children[0]).toMatchObject({ nodeType: 'Seq Scan', detail: 'orders', estimatedCost: 50 });
    expect(root.children[1]!.children[0]).toMatchObject({ nodeType: 'Seq Scan', detail: 'users' });
  });

  it('carries actual timings through under ANALYZE', () => {
    const plan = [{ Plan: { 'Node Type': 'Seq Scan', 'Actual Total Time': 3.14, 'Actual Rows': 42 } }];
    const root = pgParseExplain([{ 'QUERY PLAN': plan }]);
    expect(root.actualTimeMs).toBe(3.14);
    expect(root.actualRows).toBe(42);
  });
});

describe('explain-plan — SQLite (EXPLAIN QUERY PLAN steps)', () => {
  it('builds the step statement', () => {
    expect(sqliteBuildExplain('SELECT 1').sql).toBe('EXPLAIN QUERY PLAN SELECT 1');
  });

  it('links id/parent steps into a tree under a synthetic root', () => {
    const root = sqliteParseExplain([
      { id: 2, parent: 0, detail: 'SCAN orders' },
      { id: 4, parent: 0, detail: 'SEARCH users USING INDEX' },
      { id: 6, parent: 2, detail: 'USE TEMP B-TREE FOR ORDER BY' },
    ]);
    expect(root.nodeType).toBe('QUERY PLAN');
    expect(root.children).toHaveLength(2);
    expect(root.children[0]).toMatchObject({ nodeType: 'SCAN', detail: 'SCAN orders' });
    expect(root.children[0]!.children[0]).toMatchObject({ nodeType: 'USE', detail: 'USE TEMP B-TREE FOR ORDER BY' });
    expect(root.children[1]!.nodeType).toBe('SEARCH');
  });
});

describe('explain-plan — MySQL (FORMAT=JSON)', () => {
  it('builds the JSON statement', () => {
    expect(mysqlBuildExplain('SELECT 1').sql).toBe('EXPLAIN FORMAT=JSON SELECT 1');
  });

  it('walks query_block → nested_loop → tables', () => {
    const explain = JSON.stringify({
      query_block: {
        select_id: 1,
        cost_info: { query_cost: '15.50' },
        nested_loop: [
          { table: { table_name: 'orders', access_type: 'ALL', rows_examined_per_scan: 100, cost_info: { read_cost: '5.0' } } },
          { table: { table_name: 'users', access_type: 'eq_ref', rows_produced_per_join: 100, cost_info: { read_cost: '3.0' } } },
        ],
      },
    });

    const root = mysqlParseExplain([{ EXPLAIN: explain }]);
    expect(root.nodeType).toBe('Query block');
    expect(root.estimatedCost).toBe(15.5);
    expect(root.children[0]!.nodeType).toBe('Nested loop');
    expect(root.children[0]!.children).toHaveLength(2);
    expect(root.children[0]!.children[0]).toMatchObject({ nodeType: 'Table', detail: 'orders', estimatedCost: 5, estimatedRows: 100 });
  });

  it('walks an ordering_operation wrapping a single table', () => {
    const explain = JSON.stringify({
      query_block: { ordering_operation: { using_filesort: true, table: { table_name: 'events', rows_examined_per_scan: 10 } } },
    });
    const root = mysqlParseExplain([{ EXPLAIN: explain }]);
    expect(root.children[0]!.nodeType).toBe('Ordering');
    expect(root.children[0]!.children[0]).toMatchObject({ nodeType: 'Table', detail: 'events' });
  });
});
