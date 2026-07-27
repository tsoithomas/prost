import type { QueryPlanNode } from '@prost/shared-types';
import type { SqlFragment } from '../types';

/**
 * Pure structured-plan builders/parsers for Phase 26, shared across drivers (like `fk-ddl.ts`). Each
 * `*BuildExplain` returns the engine's structured-EXPLAIN statement; each `*ParseExplain` turns its
 * result rows into a normalized `QueryPlanNode` tree. No DB access — fully unit-testable.
 */

function numberOrUndefined(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

type Obj = Record<string, unknown>;

const asObj = (value: unknown): Obj | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Obj) : undefined;

// ─── PostgreSQL: EXPLAIN (FORMAT JSON [, ANALYZE, BUFFERS]) ──────────────────────────────────────

export function pgBuildExplain(sql: string, analyze: boolean): SqlFragment {
  const options = analyze ? 'FORMAT JSON, ANALYZE, BUFFERS' : 'FORMAT JSON';
  return { sql: `EXPLAIN (${options}) ${sql}`, params: [] };
}

/** Node keys folded into the one-line `detail` (first non-empty wins-ish, joined). */
const PG_DETAIL_KEYS = ['Relation Name', 'Index Name', 'CTE Name', 'Function Name', 'Join Type', 'Strategy'];

export function pgParseExplain(rows: Record<string, unknown>[]): QueryPlanNode {
  const raw = rows[0]?.['QUERY PLAN'];
  // node-postgres returns json columns already parsed; tolerate a string too.
  const parsed = typeof raw === 'string' ? safeJsonParse(raw) : raw;
  const rootPlan = Array.isArray(parsed) ? asObj((parsed[0] as Obj | undefined)?.['Plan']) : undefined;
  return rootPlan ? mapPgNode(rootPlan) : { nodeType: 'Unknown', children: [] };
}

function mapPgNode(node: Obj): QueryPlanNode {
  const detail =
    PG_DETAIL_KEYS.map((key) => node[key])
      .filter((value): value is string | number => typeof value === 'string' || typeof value === 'number')
      .join(' · ') || undefined;
  const children = Array.isArray(node['Plans']) ? (node['Plans'] as Obj[]).map(mapPgNode) : [];
  return {
    nodeType: typeof node['Node Type'] === 'string' ? (node['Node Type'] as string) : 'Node',
    detail,
    estimatedCost: numberOrUndefined(node['Total Cost']),
    estimatedRows: numberOrUndefined(node['Plan Rows']),
    actualTimeMs: numberOrUndefined(node['Actual Total Time']),
    actualRows: numberOrUndefined(node['Actual Rows']),
    children,
    fields: scalarFields(node, ['Plans']),
  };
}

// ─── SQLite: EXPLAIN QUERY PLAN (flat id/parent step list) ───────────────────────────────────────

export function sqliteBuildExplain(sql: string): SqlFragment {
  return { sql: `EXPLAIN QUERY PLAN ${sql}`, params: [] };
}

export function sqliteParseExplain(rows: Record<string, unknown>[]): QueryPlanNode {
  const root: QueryPlanNode = { nodeType: 'QUERY PLAN', children: [] };
  const byId = new Map<number, QueryPlanNode>([[0, root]]);
  // Pass 1: create every node (rows may reference a parent that appears later).
  for (const row of rows) {
    const detail = String(row['detail'] ?? '');
    byId.set(Number(row['id']), { nodeType: sqliteStepType(detail), detail, children: [] });
  }
  // Pass 2: link each node under its parent (falling back to the synthetic root).
  for (const row of rows) {
    const node = byId.get(Number(row['id']))!;
    (byId.get(Number(row['parent'])) ?? root).children.push(node);
  }
  return root;
}

function sqliteStepType(detail: string): string {
  return detail.trim().split(/\s+/)[0]?.toUpperCase() || 'STEP';
}

// ─── MySQL: EXPLAIN FORMAT=JSON (irregular nested query_block) ───────────────────────────────────

export function mysqlBuildExplain(sql: string): SqlFragment {
  return { sql: `EXPLAIN FORMAT=JSON ${sql}`, params: [] };
}

export function mysqlParseExplain(rows: Record<string, unknown>[]): QueryPlanNode {
  const raw = rows[0]?.['EXPLAIN'];
  const parsed = typeof raw === 'string' ? asObj(safeJsonParse(raw)) : asObj(raw);
  const block = asObj(parsed?.['query_block']);
  return block ? mysqlBlockNode(block) : { nodeType: 'Unknown', children: [] };
}

/** Operation keys nested inside a query_block / operation, in resolution order. */
const MYSQL_OPERATIONS: [key: string, label: string][] = [
  ['ordering_operation', 'Ordering'],
  ['grouping_operation', 'Grouping'],
  ['duplicates_removal', 'Distinct'],
];

function mysqlBlockNode(block: Obj): QueryPlanNode {
  return {
    nodeType: 'Query block',
    detail: block['select_id'] !== undefined ? `select #${block['select_id']}` : undefined,
    estimatedCost: numberOrUndefined(asObj(block['cost_info'])?.['query_cost']),
    children: mysqlOperationChildren(block),
    fields: scalarFields(block, ['cost_info', 'query_block']),
  };
}

/** Resolve the single main operation nested in `obj` (ordering→grouping→nested_loop→table→union). */
function mysqlOperationChildren(obj: Obj): QueryPlanNode[] {
  for (const [key, label] of MYSQL_OPERATIONS) {
    const op = asObj(obj[key]);
    if (op) return [{ nodeType: label, children: mysqlOperationChildren(op), fields: scalarFields(op, [key]) }];
  }
  if (Array.isArray(obj['nested_loop'])) {
    return [{
      nodeType: 'Nested loop',
      children: (obj['nested_loop'] as Obj[]).map((item) => mysqlTableNode(asObj(item['table']) ?? item)),
    }];
  }
  const table = asObj(obj['table']);
  if (table) return [mysqlTableNode(table)];
  const union = asObj(obj['union_result']);
  if (union && Array.isArray(union['query_specifications'])) {
    return [{
      nodeType: 'Union',
      children: (union['query_specifications'] as Obj[])
        .map((spec) => asObj(spec['query_block']))
        .filter((b): b is Obj => b !== undefined)
        .map(mysqlBlockNode),
    }];
  }
  return [];
}

function mysqlTableNode(table: Obj): QueryPlanNode {
  const cost = asObj(table['cost_info']);
  const children: QueryPlanNode[] = [];
  const materialized = asObj(table['materialized_from_subquery']);
  if (materialized) {
    const block = asObj(materialized['query_block']) ?? materialized;
    children.push(mysqlBlockNode(block));
  }
  return {
    nodeType: 'Table',
    detail: typeof table['table_name'] === 'string' ? (table['table_name'] as string) : undefined,
    estimatedCost: numberOrUndefined(cost?.['read_cost'] ?? cost?.['prefix_cost']),
    estimatedRows: numberOrUndefined(table['rows_produced_per_join'] ?? table['rows_examined_per_scan']),
    children,
    fields: scalarFields(table, ['cost_info', 'used_key_parts', 'materialized_from_subquery']),
  };
}

// ─── shared helpers ─────────────────────────────────────────────────────────────────────────────

function scalarFields(obj: Obj, exclude: string[]): Record<string, string | number> | undefined {
  const fields: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (exclude.includes(key)) continue;
    if (typeof value === 'string' || typeof value === 'number') fields[key] = value;
  }
  return Object.keys(fields).length > 0 ? fields : undefined;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
