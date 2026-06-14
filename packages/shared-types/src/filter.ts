export type FilterOperator =
  | 'eq'
  | 'neq'
  | 'lt'
  | 'lte'
  | 'gt'
  | 'gte'
  | 'contains'
  | 'startsWith'
  | 'endsWith'
  | 'isNull'
  | 'isNotNull'
  | 'in';

export interface ColumnFilter {
  column: string;
  operator: FilterOperator;
  value?: unknown;
  values?: unknown[];
}

export interface RowFilter {
  conditions: ColumnFilter[];
  combinator: 'and' | 'or';
}
