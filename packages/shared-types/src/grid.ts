import type { ColumnMetadata } from './metadata.js';

/**
 * How the client must build the optimistic-concurrency guard when writing an edited row back:
 * - `token`: the read carried a server-issued version token (Postgres `xmin`) on each row under
 *   the reserved `__version` key; send it back as `BulkRowEdit.version`.
 * - `preimage`: no row version exists (SQLite); send the original (pre-edit) values of exactly the
 *   edited columns as `BulkRowEdit.expected`.
 */
export type RowConcurrency = 'token' | 'preimage';

/** Reserved key carrying the per-row version token in `token` concurrency mode. Never a real column. */
export const ROW_VERSION_KEY = '__version';

export interface GridResponse {
  rows: Record<string, unknown>[];
  columns: ColumnMetadata[];
  totalRows: number;
  editable: boolean;
  sourceTable?: string;
  primaryKey?: string[];
  /** How the client must guard writes for this result set (set on editable table reads). */
  concurrency?: RowConcurrency;
}

/** One column's new value within a staged row edit. */
export interface CellEdit {
  column: string;
  value: unknown;
}

/**
 * A single row's worth of staged edits plus the concurrency guard. Exactly one of `version` /
 * `expected` must be present, matching the `GridResponse.concurrency` the rows were read with.
 */
export interface BulkRowEdit {
  primaryKey: Record<string, unknown>;
  edits: CellEdit[];
  /** `token` mode: the `__version` value read with this row. */
  version?: string;
  /** `preimage` mode: original values of exactly the columns in `edits`. */
  expected?: Record<string, unknown>;
}

export interface BulkRowUpdateRequest {
  connectionId: string;
  schema: string;
  table: string;
  rows: BulkRowEdit[];
}

/** Body for `POST /connections/:id/tables/:schema/:table/rows/bulk` (connection/schema/table from the URL). */
export type BulkRowUpdateBody = Omit<BulkRowUpdateRequest, 'connectionId' | 'schema' | 'table'>;

export interface BulkRowUpdateResult {
  /** Fresh server rows in request order (refreshed `__version` in `token` mode). */
  rows: Record<string, unknown>[];
}

interface StatementResultBase {
  /** The statement's own source text (as split from the script) — used for per-statement headers. */
  sql: string;
  executionTimeMs: number;
}

export interface RowsStatementResult extends GridResponse, StatementResultBase {
  kind: 'rows';
  /** `true` when more rows exist beyond the returned page (architecture principle §7). */
  truncated?: boolean;
}

/** A statement that ran but produced no rows (INSERT/UPDATE/DELETE/DDL/transaction control). */
export interface CommandStatementResult extends StatementResultBase {
  kind: 'command';
  command: string;
  rowCount: number;
}

/**
 * `EXPLAIN` / `EXPLAIN ANALYZE` output. `planText` is the `QUERY PLAN` column's rows joined
 * with `\n`, rendered verbatim in a monospace block. `analyze: true` means this statement
 * actually executed the underlying query.
 */
export interface PlanStatementResult extends StatementResultBase {
  kind: 'plan';
  planText: string;
  analyze: boolean;
}

/** A statement that failed. `code` is the Postgres SQLSTATE if available. */
export interface ErrorStatementResult extends StatementResultBase {
  kind: 'error';
  message: string;
  code?: string;
  correlationId: string;
}

export type StatementResult = RowsStatementResult | CommandStatementResult | PlanStatementResult | ErrorStatementResult;

/** Response for `POST /connections/:id/query`. */
export interface ExecuteQueryResponse {
  statements: StatementResult[];
  /** Echoes the request's `transactional` flag. */
  transactional: boolean;
  /** Total statements split from the script — lets the UI report "N of M ran" after a rollback. */
  statementCount: number;
}

/** Body for `POST /connections/:id/query`. */
export interface ExecuteQueryBody {
  sql: string;
  /** Wrap the whole batch in BEGIN/COMMIT, ROLLBACK the batch on any error. Default `false`. */
  transactional?: boolean;
}

/**
 * Body for `POST /connections/:id/query/page` — fetches the next page of a single SELECT
 * (the editor's "Load more"). `sql` must be exactly one SELECT statement; mutations are rejected.
 */
export interface FetchQueryPageBody {
  sql: string;
  offset: number;
  limit?: number;
}

/** Response for `POST /connections/:id/query/page` — just the next page of rows. */
export interface FetchQueryPageResponse {
  rows: Record<string, unknown>[];
  /** `true` when still more rows exist beyond this page. */
  truncated: boolean;
  executionTimeMs: number;
}

/**
 * Body for `POST /connections/:id/query/cursor` — opens a forward-only server-side cursor for a
 * single SELECT (the streaming alternative to growing-OFFSET paging, used for large editor
 * results). `sql` must be exactly one SELECT statement; mutations and EXPLAIN are rejected.
 */
export interface OpenCursorBody {
  sql: string;
}

/**
 * Response for `POST /connections/:id/query/cursor`. Carries the first block plus the
 * `GridResponse` metadata (columns/editability) so the grid renders identically to the offset
 * path. `sessionId` addresses the held cursor for subsequent fetches; when `complete` is already
 * `true` the result fit in the first block and the cursor is closed (a small result).
 */
export interface OpenCursorResponse extends GridResponse {
  sessionId: string;
  /** The first block exhausted the result and the cursor is already closed. */
  complete: boolean;
  /** The server-side total-row budget was hit; no more rows will be served (architecture principle §7/§11). */
  truncated?: boolean;
}

/** Body for `POST /connections/:id/query/cursor/:sessionId/fetch` — pull the next forward block. */
export interface FetchCursorBody {
  limit?: number;
}

/** Response for a cursor fetch — the next block plus end-of-stream / truncation signalling. */
export interface FetchCursorResponse {
  rows: Record<string, unknown>[];
  /** No more rows remain; the cursor is closed. */
  complete: boolean;
  /** The total-row budget was hit; the cursor is closed with rows left unserved. */
  truncated?: boolean;
  executionTimeMs: number;
}

export interface RowUpdateRequest {
  connectionId: string;
  schema: string;
  table: string;
  primaryKey: Record<string, unknown>;
  column: string;
  value: unknown;
}

export interface RowInsertRequest {
  connectionId: string;
  schema: string;
  table: string;
  values: Record<string, unknown>;
}

export interface RowDeleteRequest {
  connectionId: string;
  schema: string;
  table: string;
  primaryKey: Record<string, unknown>;
}

/** Body for `PATCH /connections/:id/tables/:schema/:table/rows` (connection/schema/table come from the URL). */
export type RowUpdateBody = Omit<RowUpdateRequest, 'connectionId' | 'schema' | 'table'>;

/** Body for `POST /connections/:id/tables/:schema/:table/rows` (connection/schema/table come from the URL). */
export type RowInsertBody = Omit<RowInsertRequest, 'connectionId' | 'schema' | 'table'>;

/** Body for `DELETE /connections/:id/tables/:schema/:table/rows` (connection/schema/table come from the URL). */
export type RowDeleteBody = Omit<RowDeleteRequest, 'connectionId' | 'schema' | 'table'>;
