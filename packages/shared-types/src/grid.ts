import type { ColumnMetadata } from './metadata.js';

export interface GridResponse {
  rows: Record<string, unknown>[];
  columns: ColumnMetadata[];
  totalRows: number;
  editable: boolean;
  sourceTable?: string;
  primaryKey?: string[];
}

export interface QueryResult extends GridResponse {
  executionTimeMs: number;
  /** `true` when more rows exist beyond the returned page (architecture principle §7). */
  truncated?: boolean;
  /**
   * For non-`SELECT` statements (`UPDATE`/`INSERT`/`DELETE`/DDL): the executed command (e.g.
   * `'UPDATE'`) and rows affected. `rows`/`columns` are empty and `editable` is `false`.
   */
  command?: string;
  rowCount?: number;
}

/** Body for `POST /connections/:id/query`. */
export interface ExecuteQueryBody {
  sql: string;
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
