import type {
  AlterTableOperation,
  CreateIndexRequest,
  CreateTableRequest,
} from '@prost/shared-types';
import type {
  ConnectionParams,
  DbCapabilities,
  DriverQueryFn,
  DriverResult,
  NativePool,
  SelectRowsOptions,
  SqlFragment,
  TableRef,
  TestConnectionResult,
} from './types';

/** Nest multi-provider token: every registered driver is injected as an array. */
export const DB_DRIVERS = Symbol('DB_DRIVERS');

export interface DbDriver {
  readonly engine: string;
  readonly capabilities: DbCapabilities;

  // --- connection lifecycle (called by PoolManager) ---
  createPool(params: ConnectionParams): Promise<NativePool>;
  closePool(pool: NativePool): Promise<void>;
  query(pool: NativePool, frag: SqlFragment): Promise<DriverResult>;
  withTransaction<T>(pool: NativePool, fn: (q: DriverQueryFn) => Promise<T>): Promise<T>;
  testConnection(params: ConnectionParams): Promise<TestConnectionResult>;

  // --- dialect helpers ---
  quoteIdent(identifier: string): string;
  /** 1-based positional placeholder, e.g. PG `$1`, future MySQL `?`. */
  placeholder(index: number): string;

  // --- metadata builders ---
  buildListTables(): SqlFragment;
  buildListAllColumns(): SqlFragment;
  buildListColumns(ref: TableRef): SqlFragment;
  buildListIndexes(ref: TableRef): SqlFragment;

  // --- grid builders ---
  buildSelectRows(ref: TableRef, opts: SelectRowsOptions): SqlFragment;
  buildFilteredRowCount(ref: TableRef, whereClause: string, whereParams: unknown[]): SqlFragment;
  buildRowCountEstimate(ref: TableRef): SqlFragment;
  buildInsertRow(ref: TableRef, entries: [string, unknown][]): SqlFragment;
  buildUpdateRow(ref: TableRef, column: string, value: unknown, pkColumns: string[], pkValues: unknown[]): SqlFragment;
  buildDeleteRow(ref: TableRef, pkColumns: string[], pkValues: unknown[]): SqlFragment;

  // --- ddl builders ---
  buildCreateTable(req: CreateTableRequest): SqlFragment;
  buildAlterTable(ref: TableRef, op: AlterTableOperation): SqlFragment;
  buildCreateIndex(req: CreateIndexRequest, name: string, method: string): SqlFragment;
  buildDropIndex(ref: TableRef, indexName: string): SqlFragment;

  // --- query-editor support ---
  buildResolveTypeNames(oids: number[]): SqlFragment;

  /** Inspect a native error; throw the right Nest HTTP exception, or return to let the caller rethrow. */
  mapError(error: unknown, context: DriverErrorContext): void;
}

export interface DriverErrorContext {
  operation: 'createTable' | 'alterTable' | 'createIndex' | 'dropIndex';
  ref?: TableRef;
  detail?: string;
}
