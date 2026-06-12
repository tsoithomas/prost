export interface ColumnMetadata {
  name: string;
  dataType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
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
  tables: TableSummary[];
}
