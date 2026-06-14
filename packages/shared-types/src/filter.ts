export type FilterOperator =
  | 'eq'
  | 'neq'
  | 'lt'
  | 'lte'
  | 'gt'
  | 'gte'
  | 'contains'
  | 'notContains'
  | 'startsWith'
  | 'notStartsWith'
  | 'endsWith'
  | 'notEndsWith'
  | 'isNull'
  | 'isNotNull'
  | 'in'
  | 'notIn';

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
