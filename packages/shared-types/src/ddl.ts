export interface NewColumn {
  name: string;
  type: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  autoIncrement?: boolean;
  default?: string;
}

export interface CreateTableRequest {
  schema: string;
  table: string;
  columns: NewColumn[];
}

export type CreateTableBody = CreateTableRequest;

export interface CreateTableResult {
  schema: string;
  table: string;
  sql: string;
}

/** Referential actions offered for a foreign key's ON DELETE / ON UPDATE. */
export const FOREIGN_KEY_ACTIONS = ['NO ACTION', 'RESTRICT', 'CASCADE', 'SET NULL', 'SET DEFAULT'] as const;
export type ForeignKeyAction = (typeof FOREIGN_KEY_ACTIONS)[number];

export type AlterTableOperation =
  | { kind: 'addColumn'; column: NewColumn }
  | { kind: 'dropColumn'; column: string }
  | { kind: 'setNotNull'; column: string; notNull: boolean }
  | { kind: 'setDefault'; column: string; default: string | null }
  | { kind: 'changeType'; column: string; type: string; using?: string }
  | {
      kind: 'addForeignKey';
      /** Optional; the server synthesizes a name (`<table>_<cols>_fkey`) when omitted. */
      constraintName?: string;
      /** Local (referencing) columns, ordered. */
      columns: string[];
      /** Referenced schema; omit/`null` where the engine has no schema namespace (MySQL/SQLite). */
      referencedSchema?: string | null;
      referencedTable: string;
      /** Referenced columns, 1:1 with `columns`. */
      referencedColumns: string[];
      onDelete?: ForeignKeyAction;
      onUpdate?: ForeignKeyAction;
    }
  | { kind: 'dropForeignKey'; constraintName: string };

export interface AlterTableRequest {
  schema: string;
  table: string;
  operation: AlterTableOperation;
}

/** Wire body the frontend sends — matches the flat AlterTableDto shape on the server. */
export type AlterTableBody =
  | { kind: 'addColumn'; column: NewColumn }
  | { kind: 'dropColumn'; columnName: string }
  | { kind: 'setNotNull'; columnName: string; notNull: boolean }
  | { kind: 'setDefault'; columnName: string; default: string | null }
  | { kind: 'changeType'; columnName: string; type: string; using?: string }
  | {
      kind: 'addForeignKey';
      constraintName?: string;
      columns: string[];
      referencedSchema?: string | null;
      referencedTable: string;
      referencedColumns: string[];
      onDelete?: ForeignKeyAction;
      onUpdate?: ForeignKeyAction;
    }
  | { kind: 'dropForeignKey'; constraintName: string };

export interface AlterTableResult {
  schema: string;
  table: string;
  sql: string;
}

export interface CreateIndexRequest {
  schema: string;
  table: string;
  name?: string;
  columns: string[];
  unique: boolean;
  method?: string;
}
export interface CreateIndexResult {
  schema: string;
  table: string;
  name: string;
  sql: string;
}

export interface DropIndexRequest {
  schema: string;
  table: string;
  index: string;
}
export interface DropIndexResult {
  schema: string;
  index: string;
  sql: string;
}

export interface DropTableRequest {
  schema: string;
  table: string;
}
export interface DropTableResult {
  schema: string;
  table: string;
  sql: string;
}

export interface TruncateTableRequest {
  schema: string;
  table: string;
}
export interface TruncateTableResult {
  schema: string;
  table: string;
  sql: string;
}

export type DdlPreviewRequest =
  | { kind: 'createTable'; request: CreateTableRequest }
  | { kind: 'alterTable'; request: AlterTableRequest }
  | { kind: 'createIndex'; request: CreateIndexRequest }
  | { kind: 'dropIndex'; request: DropIndexRequest }
  | { kind: 'dropTable'; request: DropTableRequest }
  | { kind: 'truncateTable'; request: TruncateTableRequest };

export interface DdlPreviewResult {
  sql: string;
}
