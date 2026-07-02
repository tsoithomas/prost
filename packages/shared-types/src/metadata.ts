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

export interface SchemaMetadata {
  name: string;
  tables: TableMetadata[];
}

export interface IndexMetadata {
  name: string;
  columns: string[];
  isUnique: boolean;
  isPrimary: boolean;
  method: string;
  definition: string;
}

export interface TableStructure {
  columns: ColumnMetadata[];
  indexes: IndexMetadata[];
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
