import type { ColumnMetadata } from './metadata.js';

export interface GridResponse {
  rows: Record<string, unknown>[];
  columns: ColumnMetadata[];
  totalRows: number;
  editable: boolean;
  sourceTable?: string;
  primaryKey?: string[];
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
