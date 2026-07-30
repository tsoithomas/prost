export interface ColumnMetadata {
  name: string;
  dataType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  autoIncrement: boolean;
  defaultValue: string | null;
}

export interface TableMetadata {
  schema: string;
  name: string;
  columns: ColumnMetadata[];
}

export interface TableSummary {
  schema: string;
  name: string;
}

/** A non-table schema object (read-only browsing — Phase 24). */
export type SchemaObjectKind =
  | 'view'
  | 'materializedView'
  | 'sequence'
  | 'function'
  | 'procedure'
  | 'trigger'
  | 'enum';

export interface SchemaObjectSummary {
  kind: SchemaObjectKind;
  /** `null` where the engine has no schema namespace (MySQL/SQLite). */
  schema: string | null;
  name: string;
  comment?: string;
}

/** One object's definition, fetched on demand for the definition panel. */
export interface SchemaObjectDetail extends SchemaObjectSummary {
  /** View/function/trigger source or `CREATE` text, from the engine's catalog. */
  definition?: string;
  /** Engine-specific extras: enum labels, sequence current value, routine language, … */
  extra?: Record<string, string>;
}

export interface SchemaMetadata {
  name: string;
  tables: TableMetadata[];
  /** Non-table objects in this schema (views/functions/triggers/…), for the tree groups. */
  objects: SchemaObjectSummary[];
}

export interface IndexMetadata {
  name: string;
  columns: string[];
  isUnique: boolean;
  isPrimary: boolean;
  method: string;
  definition: string;
}

export interface ForeignKeyMetadata {
  constraintName: string;
  /** Local (referencing) columns, ordered. */
  columns: string[];
  /** Referenced schema, or `null` where the engine has no schema namespace (MySQL/SQLite). */
  referencedSchema: string | null;
  referencedTable: string;
  /** Referenced columns, 1:1 with `columns`. */
  referencedColumns: string[];
  /** Referential action, e.g. `'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION' | 'SET DEFAULT'`. */
  onDelete?: string;
  onUpdate?: string;
}

/**
 * A foreign key qualified by the table that *owns* it: `schema.table` (the child) references
 * `referencedSchema.referencedTable` (the parent). One edge of a schema's relationship graph —
 * what `GET :id/schemas/:schema/foreign-keys` returns for the ER diagram (Phase 36).
 */
export interface SchemaForeignKey extends ForeignKeyMetadata {
  /** The referencing (child) table that owns this FK. */
  table: string;
  /** The referencing table's schema, or `null` where the engine has no schema namespace. */
  schema: string | null;
}

/**
 * A foreign key on *another* table that points *at* the current table — the inverse of
 * `ForeignKeyMetadata`. `table`/`schema` identify the referencing (child) table; `columns` are its
 * local FK columns, and `referencedColumns` are the current table's columns they point at. Powers
 * "show referencing rows" navigation. Structurally a `SchemaForeignKey` viewed from the parent.
 */
export type ReferencingKeyMetadata = SchemaForeignKey;

export interface TableStructure {
  columns: ColumnMetadata[];
  indexes: IndexMetadata[];
  foreignKeys: ForeignKeyMetadata[];
}

/**
 * How a profile's aggregates were scoped (Phase 37). `full` scanned every row; `random` used the
 * engine's random sampling (PG `TABLESAMPLE`); `firstRows` used a bounded `LIMIT` — biased by
 * physical order, so the UI must say so.
 */
export type ProfileSampleKind = 'full' | 'random' | 'firstRows';

/** One column's data shape over the scanned rows. */
export interface ColumnProfile {
  column: string;
  dataType: string;
  nullCount: number;
  /** `nullCount / scannedRows`, 0..1; `0` when nothing was scanned. */
  nullFraction: number;
  /**
   * `null` for types the engine can't compare (PG `json` has no equality operator, so neither
   * `COUNT(DISTINCT)` nor `MIN`/`MAX` are valid) — the same types that get a null `min`/`max`.
   */
  distinctCount: number | null;
  /** Rendered as text. `null` for types with no meaningful ordering (json/xml/array/binary). */
  min: string | null;
  max: string | null;
  /** Whether this column supports the top-N distribution (it needs `GROUP BY`, i.e. equality). */
  comparable: boolean;
}

/** Response for `GET :id/tables/:schema/:table/profile`. */
export interface TableProfile {
  schema: string;
  table: string;
  /** Rows the aggregates actually saw. */
  scannedRows: number;
  /** Whole-table size: a catalog estimate, or an exact count when `exact` was requested. */
  totalRows: number | null;
  sample: ProfileSampleKind;
  /** Whether the caller opted into exact counting (no sampling, real `COUNT(*)`). */
  exact: boolean;
  /**
   * Columns beyond the per-request cap that weren't profiled — engines limit how wide a result row
   * can be, so a very wide table profiles a prefix rather than failing.
   */
  columnsOmitted: number;
  columns: ColumnProfile[];
}

/** One value's share of a column, for the top-N distribution. */
export interface ColumnValueShare {
  /** `null` is a real bucket here — a column can be mostly null. */
  value: string | null;
  count: number;
  /** `count / scannedRows`, 0..1. */
  fraction: number;
}

/** Response for `GET :id/tables/:schema/:table/profile/:column/values` (fetched on expand). */
export interface ColumnTopValues {
  column: string;
  scannedRows: number;
  values: ColumnValueShare[];
}

/** One table's row in the per-schema overview page (phpMyAdmin-style). */
export interface TableOverview {
  schema: string;
  name: string;
  /** Approximate row count; `null` when the engine has no cheap estimate (SQLite). */
  rowEstimate: number | null;
  /** Total on-disk size in bytes; `null` when unavailable (SQLite). */
  sizeBytes: number | null;
  columnCount: number;
  indexCount: number;
  /** MySQL storage engine (InnoDB/MyISAM); `null` for Postgres/SQLite. */
  engine: string | null;
  /** MySQL table collation; `null` elsewhere. */
  collation: string | null;
  /** Table comment (PG `obj_description` / MySQL `TABLE_COMMENT`); `null` when none. */
  comment: string | null;
}

/** Response for `GET /connections/:id/schemas/:schema/overview`. */
export interface SchemaOverview {
  schema: string;
  tables: TableOverview[];
  /** Sum of non-null per-table row estimates; `null` when none are available. */
  totalRowEstimate: number | null;
  /** Sum of non-null per-table sizes; `null` when none are available. */
  totalSizeBytes: number | null;
}
