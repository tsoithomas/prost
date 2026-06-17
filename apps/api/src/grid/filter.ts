import { BadRequestException } from '@nestjs/common';
import { quoteIdent } from '@prost/utils';
import type { ColumnFilter, ColumnMetadata, FilterOperator, RowFilter } from '@prost/shared-types';

type TypeFamily = 'text' | 'numeric' | 'datetime' | 'boolean' | 'other';

const TEXT_TYPES = new Set([
  'text', 'character varying', 'character', 'name', 'citext', 'varchar', 'char', 'bpchar',
]);
const NUMERIC_TYPES = new Set([
  'integer', 'bigint', 'smallint', 'int', 'int2', 'int4', 'int8',
  'real', 'double precision', 'float4', 'float8',
  'numeric', 'decimal', 'money',
]);
const DATETIME_TYPES = new Set([
  'date',
  'timestamp without time zone', 'timestamp with time zone',
  'timestamp', 'timestamptz',
  'time without time zone', 'time with time zone',
  'time', 'timetz',
  'interval',
]);
const BOOLEAN_TYPES = new Set(['boolean', 'bool']);

function typeFamily(dataType: string): TypeFamily {
  const t = dataType.toLowerCase();
  if (TEXT_TYPES.has(t)) return 'text';
  if (NUMERIC_TYPES.has(t)) return 'numeric';
  if (t.startsWith('timestamp') || t.startsWith('time') || DATETIME_TYPES.has(t)) return 'datetime';
  if (BOOLEAN_TYPES.has(t)) return 'boolean';
  return 'other';
}

const OPERATORS_BY_FAMILY: Record<TypeFamily, Set<FilterOperator>> = {
  text: new Set(['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'contains', 'notContains', 'startsWith', 'notStartsWith', 'endsWith', 'notEndsWith', 'isNull', 'isNotNull', 'in', 'notIn']),
  numeric: new Set(['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'isNull', 'isNotNull', 'in', 'notIn']),
  datetime: new Set(['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'isNull', 'isNotNull']),
  boolean: new Set(['eq', 'neq', 'isNull', 'isNotNull']),
  other: new Set(['eq', 'neq', 'isNull', 'isNotNull']),
};

interface WhereDialect {
  placeholder: (index: number) => string;
  quoteIdent: (identifier: string) => string;
}

/** Returns the SQL fragment and bound params for a single condition. */
function compileSingleCondition(
  condition: ColumnFilter,
  paramIndex: number,
  dialect: WhereDialect,
): { fragment: string; params: unknown[] } {
  const col = dialect.quoteIdent(condition.column);
  const ph = dialect.placeholder(paramIndex);

  switch (condition.operator) {
    case 'eq':
      return { fragment: `${col} = ${ph}`, params: [condition.value] };
    case 'neq':
      return { fragment: `${col} <> ${ph}`, params: [condition.value] };
    case 'lt':
      return { fragment: `${col} < ${ph}`, params: [condition.value] };
    case 'lte':
      return { fragment: `${col} <= ${ph}`, params: [condition.value] };
    case 'gt':
      return { fragment: `${col} > ${ph}`, params: [condition.value] };
    case 'gte':
      return { fragment: `${col} >= ${ph}`, params: [condition.value] };
    case 'contains':
      return { fragment: `${col} ILIKE ${ph}`, params: [`%${String(condition.value)}%`] };
    case 'notContains':
      return { fragment: `${col} NOT ILIKE ${ph}`, params: [`%${String(condition.value)}%`] };
    case 'startsWith':
      return { fragment: `${col} ILIKE ${ph}`, params: [`${String(condition.value)}%`] };
    case 'notStartsWith':
      return { fragment: `${col} NOT ILIKE ${ph}`, params: [`${String(condition.value)}%`] };
    case 'endsWith':
      return { fragment: `${col} ILIKE ${ph}`, params: [`%${String(condition.value)}`] };
    case 'notEndsWith':
      return { fragment: `${col} NOT ILIKE ${ph}`, params: [`%${String(condition.value)}`] };
    case 'isNull':
      return { fragment: `${col} IS NULL`, params: [] };
    case 'isNotNull':
      return { fragment: `${col} IS NOT NULL`, params: [] };
    case 'in':
      return { fragment: `${col} = ANY(${ph})`, params: [condition.values ?? []] };
    case 'notIn':
      return { fragment: `${col} <> ALL(${ph})`, params: [condition.values ?? []] };
  }
}

/**
 * Compiles a RowFilter to a parameterized WHERE clause.
 *
 * @param filter    The structured filter from the client.
 * @param columns   Live column metadata (used to validate column names and operator compatibility).
 * @param paramOffset  Number of `$n` params already bound before this WHERE (e.g. 0 for rows query).
 * @returns { clause, params } — `clause` is empty string when no conditions.
 */
export function compileWhere(
  filter: RowFilter,
  columns: ColumnMetadata[],
  paramOffset: number,
  dialect: WhereDialect = { placeholder: (i) => `$${i}`, quoteIdent },
): { clause: string; params: unknown[] } {
  if (!filter.conditions.length) {
    return { clause: '', params: [] };
  }

  const columnMap = new Map(columns.map((c) => [c.name, c]));

  const fragments: string[] = [];
  const params: unknown[] = [];

  for (const condition of filter.conditions) {
    const col = columnMap.get(condition.column);
    if (!col) {
      throw new BadRequestException(`Unknown column "${condition.column}"`);
    }

    const family = typeFamily(col.dataType);
    if (!OPERATORS_BY_FAMILY[family].has(condition.operator)) {
      throw new BadRequestException(
        `Operator "${condition.operator}" is not valid for column "${condition.column}" (type "${col.dataType}")`,
      );
    }

    const paramIndex = paramOffset + params.length + 1;
    const { fragment, params: condParams } = compileSingleCondition(condition, paramIndex, dialect);
    fragments.push(fragment);
    params.push(...condParams);
  }

  const joiner = filter.combinator === 'or' ? ' OR ' : ' AND ';
  const clause = `WHERE ${fragments.join(joiner)}`;

  return { clause, params };
}
