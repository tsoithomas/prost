import type {
  AlterTableOperation,
  ColumnMetadata,
  CreateIndexRequest,
  CreateTableRequest,
  DbEngineDescriptor,
  SchemaObjectKind,
} from '@prost/shared-types';
import type {
  ConnectionParams,
  DbCapabilities,
  DriverCursor,
  DriverQueryFn,
  DriverResult,
  NativePool,
  RowUpdateGuard,
  SelectRowsOptions,
  SqlFragment,
  TableRef,
  TestConnectionResult,
  WhereDialect,
} from './types';

/** Nest multi-provider token: every registered driver is injected as an array. */
export const DB_DRIVERS = Symbol('DB_DRIVERS');

export interface DbDriver {
  readonly engine: string;
  readonly descriptor: DbEngineDescriptor;
  readonly capabilities: DbCapabilities;

  // --- connection lifecycle (called by PoolManager) ---
  createPool(params: ConnectionParams): Promise<NativePool>;
  closePool(pool: NativePool): Promise<void>;
  query(pool: NativePool, frag: SqlFragment): Promise<DriverResult>;
  /** Pin one connection, run `fn`, no automatic transaction. Used by QueryService. */
  withSession<T>(pool: NativePool, fn: (q: DriverQueryFn) => Promise<T>): Promise<T>;
  /**
   * Open a forward-only server-side cursor over a single SELECT (`frag`), holding its pinned
   * resource across requests for streamed paging of large results (architecture principle §7).
   * Only engines whose `capabilities.supportsCursors` is true implement this. The returned handle
   * is owned by the cursor-session manager, which always `close()`s it.
   */
  openCursor(pool: NativePool, frag: SqlFragment): Promise<DriverCursor>;
  /**
   * Runs `fn` inside a single transaction: the driver issues `BEGIN` before `fn`, `COMMIT` on
   * success, and `ROLLBACK` if `fn` throws (the error then propagates). All statements `fn` runs
   * via the provided `q` share one connection/transaction, so the batch is atomic — all-or-nothing.
   */
  withTransaction<T>(pool: NativePool, fn: (q: DriverQueryFn) => Promise<T>): Promise<T>;
  testConnection(params: ConnectionParams): Promise<TestConnectionResult>;

  // --- dialect helpers ---
  quoteIdent(identifier: string): string;
  /** 1-based positional placeholder, e.g. PG `$1`, future MySQL `?`. */
  placeholder(index: number): string;
  /** Dialect-specific WHERE-clause pieces consumed by the grid filter compiler. */
  readonly whereDialect: WhereDialect;

  // --- metadata builders ---
  buildListTables(): SqlFragment;
  buildListAllColumns(): SqlFragment;
  buildListColumns(ref: TableRef): SqlFragment;
  buildListIndexes(ref: TableRef): SqlFragment;
  /**
   * Foreign-key constraints on `ref`, one row per constraint with columns aliased
   * `constraint_name, columns, referenced_schema, referenced_table, referenced_columns,
   * on_delete, on_update`. `columns`/`referenced_columns` are ordered arrays (PG native `text[]`,
   * MySQL/SQLite a JSON-encoded array string — the service normalizes both).
   */
  buildListForeignKeys(ref: TableRef): SqlFragment;
  /**
   * The inverse of `buildListForeignKeys`: FKs on *other* tables that reference `ref`. Same aliased
   * shape plus `table_name`/`table_schema` for the referencing (child) table. Powers "show
   * referencing rows" navigation.
   */
  buildListReferencingForeignKeys(ref: TableRef): SqlFragment;
  /**
   * All non-table schema objects (views/materialized views/sequences/functions/procedures/triggers/
   * enums) the engine supports, across all schemas, aliased `kind, schema, name, comment`. `kind` is
   * a `SchemaObjectKind` literal. Powers the read-only object groups in the schema tree (Phase 24).
   */
  buildListAllSchemaObjects(): SqlFragment;
  /**
   * One object's definition, aliased `definition` (+ optional engine extras the service folds into
   * `extra`). `kind` selects the catalog source; `ref.name` is the object name. Read-only.
   */
  buildObjectDefinition(kind: SchemaObjectKind, ref: TableRef): SqlFragment;
  /**
   * Per-schema table stats for the overview page — one row per base table with columns aliased
   * `table_name, row_estimate, size_bytes, column_count, index_count, engine, collation, comment`.
   * `namespace` is bound (schema for PG, database for MySQL, ignored/`'main'` for SQLite).
   */
  buildSchemaTableStats(namespace: string): SqlFragment;

  // --- grid builders ---
  buildSelectRows(ref: TableRef, opts: SelectRowsOptions): SqlFragment;
  buildFilteredRowCount(ref: TableRef, whereClause: string, whereParams: unknown[]): SqlFragment;
  buildRowCountEstimate(ref: TableRef): SqlFragment;
  buildInsertRow(ref: TableRef, entries: [string, unknown][]): SqlFragment;
  buildUpdateRow(ref: TableRef, column: string, value: unknown, pkColumns: string[], pkValues: unknown[]): SqlFragment;
  /**
   * Multi-column update of one row, guarded by an optimistic-concurrency predicate so a stale write
   * affects zero rows (the caller treats `rowCount !== 1` as a conflict). On `token` engines the
   * returned rows re-project the refreshed version token as `__version`.
   */
  buildUpdateRowGuarded(
    ref: TableRef,
    edits: [string, unknown][],
    pkColumns: string[],
    pkValues: unknown[],
    guard: RowUpdateGuard,
  ): SqlFragment;
  /** Execute an insert and return the persisted row. `q` is the transactional query fn from
   *  PoolManager.withTransaction. PG/SQLite: one `INSERT ... RETURNING *`. `columns` carries
   *  PK/AUTO_INCREMENT flags (used by MySQL later; PG/SQLite ignore it). */
  insertRow(
    q: DriverQueryFn,
    ref: TableRef,
    entries: [string, unknown][],
    columns: ColumnMetadata[],
  ): Promise<Record<string, unknown>>;
  /** Execute a single-column update and return the persisted row. Throws NotFoundException when
   *  the primary key matches no row. */
  updateRow(
    q: DriverQueryFn,
    ref: TableRef,
    column: string,
    value: unknown,
    primaryKey: string[],
    primaryKeyValues: unknown[],
  ): Promise<Record<string, unknown>>;
  buildDeleteRow(ref: TableRef, pkColumns: string[], pkValues: unknown[]): SqlFragment;

  // --- ddl builders ---
  normalizeCreateTable(req: CreateTableRequest): CreateTableRequest;
  normalizeAlterTable(ref: TableRef, operation: AlterTableOperation, columns: ColumnMetadata[]): AlterTableOperation;
  normalizeCreateIndex(req: CreateIndexRequest): { request: CreateIndexRequest; name: string; method: string };
  buildCreateTable(req: CreateTableRequest): SqlFragment;
  buildAlterTable(ref: TableRef, op: AlterTableOperation): SqlFragment;
  buildCreateIndex(req: CreateIndexRequest, name: string, method: string): SqlFragment;
  buildDropIndex(ref: TableRef, indexName: string): SqlFragment;
  buildDropTable(ref: TableRef): SqlFragment;
  /** Empty a table (PG/MySQL `TRUNCATE`; SQLite has no TRUNCATE → `DELETE FROM`). */
  buildTruncateTable(ref: TableRef): SqlFragment;

  // --- query-editor support ---
  /** Resolve result-column types into ColumnMetadata. PG runs a pg_type OID lookup through
   *  `query`; SQLite returns declared types from field metadata. Async because PG hits the DB. */
  describeResultColumns(
    query: DriverQueryFn,
    fields: { name: string; dataTypeID: number; dataTypeName?: string }[],
    primaryKey?: string[],
  ): Promise<ColumnMetadata[]>;
  formatExplain(rows: Record<string, unknown>[]): string;

  /** Inspect a native error; throw the right Nest HTTP exception, or return to let the caller rethrow. */
  mapError(error: unknown, context: DriverErrorContext): void;
}

export interface DriverErrorContext {
  operation: 'createTable' | 'alterTable' | 'createIndex' | 'dropIndex' | 'dropTable' | 'truncateTable';
  ref?: TableRef;
  detail?: string;
}
