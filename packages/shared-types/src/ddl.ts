export interface NewColumn {
  name: string;
  type: string;
  nullable: boolean;
  isPrimaryKey: boolean;
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
