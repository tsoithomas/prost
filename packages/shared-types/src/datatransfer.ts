import type { RowFilter } from './filter.js';

/**
 * Serialization format for a data export (Phase 30). `sql` (Phase 30.1) emits `INSERT` statements plus
 * an optional `CREATE TABLE`, and is valid for the `table`/`schema` scopes only (a `query` result has no
 * target table to name).
 */
export type ExportFormat = 'csv' | 'json' | 'sql';

/**
 * A streamed export request. Scopes map to bound SELECTs the server streams through the Phase 22 cursor:
 * - `table` — the given `schema`/`table`, optionally narrowed by the active `filter` and sorted.
 * - `query` — an arbitrary single-SELECT `sql` (the current query result), optionally sorted.
 * - `schema` — a multi-table SQL dump of `tables` in `schema` (schema DDL and/or data). `format:'sql'`.
 * The result is bounded by the server's streaming row budget; truncation is signalled, never silent.
 */
export interface ExportRequest {
  scope: 'table' | 'query' | 'schema';
  format: ExportFormat;
  /** `table`/`schema` scope. */
  schema?: string;
  table?: string;
  filter?: RowFilter;
  /** `schema` scope: the tables to include in the dump. */
  tables?: string[];
  /** `query` scope: a single streamable SELECT. */
  sql?: string;
  /** SQL format: emit `CREATE TABLE` DDL for each table (default true). */
  includeSchema?: boolean;
  /** SQL format: emit `INSERT` data for each table (default true). */
  includeData?: boolean;
  /** Optional ordering (baked into the streamed statement — a forward-only cursor can't re-sort). */
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  /** CSV only: field delimiter (default `,`). */
  delimiter?: string;
  /** CSV only: how a SQL NULL is rendered (default: empty field, distinct from `""`). */
  nullToken?: string | null;
}

/**
 * A client-side mapping row (UI state): which target column a CSV source column feeds. Rows are
 * projected into target-column order (`columns` + `rows`) before hitting the server, so the wire
 * requests below only carry resolved column names + values.
 */
export interface ImportColumnMapping {
  target: string;
  sourceIndex: number;
}

/** Preview an import: validates the target columns against live metadata (no execution). */
export interface ImportPreviewRequest {
  schema: string;
  table: string;
  /** Target column names, in the order sample values are given. */
  columns: string[];
  /** A few sample rows (values in `columns` order) for the preview render. */
  sampleRows: unknown[][];
}

export interface ImportPreviewResponse {
  /** The generated parameterized INSERT shape (placeholders, never values). */
  sql: string;
  /** Blocking problems with the mapping (unknown/duplicate target column, empty mapping, …). */
  issues: string[];
}

/**
 * One batch of already-parsed rows to insert. `columns` are target column names; each row in `rows`
 * is values in that same column order. Inserted atomically (all-or-nothing) in one transaction.
 */
export interface ImportBatchRequest {
  schema: string;
  table: string;
  columns: string[];
  rows: unknown[][];
}

export interface ImportBatchResponse {
  inserted: number;
}
