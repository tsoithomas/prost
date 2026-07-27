/**
 * Structured query-plan shape (Phase 26). A narrow sibling result to `GridResponse` — the driver
 * turns its engine's `EXPLAIN` output (PG `FORMAT JSON`, MySQL `FORMAT=JSON`, SQLite `QUERY PLAN`
 * steps) into this normalized tree, and the frontend renders it without re-deriving costs. The grid
 * contract is untouched (architecture principle §5).
 */
export interface QueryPlanNode {
  /** Engine node label, e.g. "Seq Scan", "Hash Join", "Nested loop", or a SQLite step verb. */
  nodeType: string;
  /** One-line summary (relation/index name, join type, condition) shown next to the node type. */
  detail?: string;
  /** Estimated total cost (PG `Total Cost`; MySQL `cost_info`). Undefined for engines without costs (SQLite). */
  estimatedCost?: number;
  estimatedRows?: number;
  /** Measured values — present only under `EXPLAIN ANALYZE`. */
  actualTimeMs?: number;
  actualRows?: number;
  children: QueryPlanNode[];
  /** Engine-specific extras surfaced in the per-node detail popover. */
  fields?: Record<string, string | number>;
}

export interface QueryPlanResult {
  root: QueryPlanNode;
  /** True when the statement was actually executed to gather real timings (`EXPLAIN ANALYZE`). */
  analyze: boolean;
  /** How the engine expressed the plan — `'json'` (PG/MySQL) or `'steps'` (SQLite). */
  format: 'json' | 'steps';
  /** The engine's raw plan text, kept as a copy source / fallback. */
  planText: string;
  executionTimeMs: number;
}

/** Request body for `POST /connections/:id/query/explain`. */
export interface ExplainQueryBody {
  sql: string;
  /** Run the statement to collect actual timings (PostgreSQL only; blocked on read-only connections). */
  analyze?: boolean;
}
