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
