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
 * A foreign key on *another* table that points *at* the current table — the inverse of
 * `ForeignKeyMetadata`. `table`/`schema` identify the referencing (child) table; `columns` are its
 * local FK columns, and `referencedColumns` are the current table's columns they point at. Powers
 * "show referencing rows" navigation.
 */
export interface ReferencingKeyMetadata extends ForeignKeyMetadata {
  /** The referencing (child) table that owns this FK. */
  table: string;
  /** The referencing table's schema, or `null` where the engine has no schema namespace. */
  schema: string | null;
}

export interface TableStructure {
  columns: ColumnMetadata[];
  indexes: IndexMetadata[];
  foreignKeys: ForeignKeyMetadata[];
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
