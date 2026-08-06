import type { ColumnMetadata, IndexMetadata, ForeignKeyMetadata } from './metadata.js';
import type {
  CreateTableRequest,
  DropTableRequest,
  AlterTableRequest,
  CreateIndexRequest,
  DropIndexRequest,
} from './ddl.js';

/** One side of a schema comparison (Phase 42) — a schema on a specific live connection. */
export interface SchemaRef {
  connectionId: string;
  schema: string;
}

/** Whether an object exists only on the left, only on the right, on both but differs, or matches. */
export type DiffStatus = 'added' | 'removed' | 'changed' | 'unchanged';

export interface ColumnDiff {
  name: string;
  status: DiffStatus;
  left: ColumnMetadata | null;
  right: ColumnMetadata | null;
}

export interface IndexDiff {
  name: string;
  status: DiffStatus;
  left: IndexMetadata | null;
  right: IndexMetadata | null;
}

export interface ForeignKeyDiff {
  constraintName: string;
  status: DiffStatus;
  left: ForeignKeyMetadata | null;
  right: ForeignKeyMetadata | null;
}

/** One table's delta. `existsLeft`/`existsRight` disambiguate presence explicitly — never inferred
 *  from the member diffs, since a table with zero columns is a (rare but legal) edge case. */
export interface TableDiff {
  name: string;
  status: DiffStatus;
  existsLeft: boolean;
  existsRight: boolean;
  columns: ColumnDiff[];
  indexes: IndexDiff[];
  foreignKeys: ForeignKeyDiff[];
}

/**
 * A schema comparison, computed live in memory and never persisted (principle §1) — a re-compare always
 * re-reads both connections. Same-engine only; cross-engine schema translation is out of scope.
 */
export interface SchemaDiff {
  left: SchemaRef;
  right: SchemaRef;
  tables: TableDiff[];
}

/**
 * The `DdlPreviewRequest` members a migration change-set may contain (Phase 42). `truncateTable` is
 * excluded — it empties data, not a schema-reconciliation op. Unlike Phase 33's `SchemaSuggestionChange`,
 * this includes destructive and structural kinds (`dropTable`, `dropIndex`, `createTable`, and
 * `alterTable`'s `dropColumn`/`addForeignKey`/`dropForeignKey`) because a diff must be able to propose
 * removing or creating whole objects, not just in-place column tweaks.
 */
export type SchemaDiffChange =
  | { kind: 'createTable'; request: CreateTableRequest }
  | { kind: 'dropTable'; request: DropTableRequest }
  | { kind: 'alterTable'; request: AlterTableRequest }
  | { kind: 'createIndex'; request: CreateIndexRequest }
  | { kind: 'dropIndex'; request: DropIndexRequest };

/**
 * One reconciling change, already re-validated server-side via `DdlService.preview` (so `sql` doubles as
 * proof it compiles against live metadata — mirrors `SchemaSuggestion`, Phase 33 Decision 3). `destructive`
 * is computed server-side (never inferred by the client) and drives the change-set checklist's
 * unchecked-by-default state (principle §8).
 */
export interface SchemaDiffChangeItem {
  change: SchemaDiffChange;
  sql: string;
  destructive: boolean;
}

/** Ask for a reconciling change-set. `source` picks which side is authoritative. */
export interface GenerateMigrationRequest {
  /** The `:id` connection's schema — `left` in the resulting diff. */
  schema: string;
  right: SchemaRef;
  source: 'left' | 'right';
}

/** Surviving changes — candidates that failed re-validation are dropped, never surfaced. */
export interface GenerateMigrationResponse {
  changes: SchemaDiffChangeItem[];
}

/** Request body for the compare endpoint. `schema` is the `:id` connection's schema — `left` in the diff. */
export interface SchemaCompareRequest {
  schema: string;
  right: SchemaRef;
}
