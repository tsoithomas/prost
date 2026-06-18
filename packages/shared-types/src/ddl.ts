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

export type AlterTableOperation =
  | { kind: 'addColumn'; column: NewColumn }
  | { kind: 'dropColumn'; column: string }
  | { kind: 'setNotNull'; column: string; notNull: boolean }
  | { kind: 'setDefault'; column: string; default: string | null }
  | { kind: 'changeType'; column: string; type: string; using?: string };

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
  | { kind: 'changeType'; columnName: string; type: string; using?: string };

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
