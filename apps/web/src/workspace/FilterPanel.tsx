import { X } from 'lucide-react';
import type { ColumnMetadata, ColumnFilter, FilterOperator, RowFilter } from '@prost/shared-types';
import { Button, IconButton, Input } from '@prost/ui';

export interface FilterPanelProps {
  columns: ColumnMetadata[];
  activeFilter: RowFilter | null;
  onChange: (filter: RowFilter | null) => void;
}

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
  'date', 'timestamp without time zone', 'timestamp with time zone',
  'timestamp', 'timestamptz', 'time without time zone', 'time with time zone',
  'time', 'timetz', 'interval',
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

const ALL_OPERATORS: { value: FilterOperator; label: string }[] = [
  { value: 'eq', label: '=' },
  { value: 'neq', label: '≠' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '≤' },
  { value: 'gt', label: '>' },
  { value: 'gte', label: '≥' },
  { value: 'contains', label: 'contains' },
  { value: 'notContains', label: 'not contains' },
  { value: 'startsWith', label: 'starts with' },
  { value: 'notStartsWith', label: 'not starts with' },
  { value: 'endsWith', label: 'ends with' },
  { value: 'notEndsWith', label: 'not ends with' },
  { value: 'in', label: 'in (comma-separated)' },
  { value: 'notIn', label: 'not in (comma-separated)' },
  { value: 'isNull', label: 'is null' },
  { value: 'isNotNull', label: 'is not null' },
];

const OPERATORS_BY_FAMILY: Record<TypeFamily, Set<FilterOperator>> = {
  text: new Set(['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'contains', 'notContains', 'startsWith', 'notStartsWith', 'endsWith', 'notEndsWith', 'isNull', 'isNotNull', 'in', 'notIn']),
  numeric: new Set(['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'isNull', 'isNotNull', 'in', 'notIn']),
  datetime: new Set(['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'isNull', 'isNotNull']),
  boolean: new Set(['eq', 'neq', 'isNull', 'isNotNull']),
  other: new Set(['eq', 'neq', 'isNull', 'isNotNull']),
};

export function operatorsForColumn(col: ColumnMetadata): FilterOperator[] {
  const family = typeFamily(col.dataType);
  return ALL_OPERATORS.filter((op) => OPERATORS_BY_FAMILY[family].has(op.value)).map((op) => op.value);
}

const NO_VALUE_OPERATORS = new Set<FilterOperator>(['isNull', 'isNotNull']);

function defaultFilter(): RowFilter {
  return { conditions: [], combinator: 'and' };
}

function firstOperatorForColumn(col: ColumnMetadata): FilterOperator {
  return operatorsForColumn(col)[0] ?? 'eq';
}

export function FilterPanel({ columns, activeFilter, onChange }: FilterPanelProps) {
  const filter = activeFilter ?? defaultFilter();

  function emit(updated: RowFilter) {
    onChange(updated.conditions.length === 0 ? null : updated);
  }

  function addCondition() {
    const firstCol = columns[0];
    if (!firstCol) return;
    const newCondition: ColumnFilter = {
      column: firstCol.name,
      operator: firstOperatorForColumn(firstCol),
      value: '',
    };
    emit({ ...filter, conditions: [...filter.conditions, newCondition] });
  }

  function removeCondition(index: number) {
    const updated = filter.conditions.filter((_, i) => i !== index);
    emit({ ...filter, conditions: updated });
  }

  function updateCondition(index: number, patch: Partial<ColumnFilter>) {
    const updated = filter.conditions.map((c, i) => (i === index ? { ...c, ...patch } : c));
    emit({ ...filter, conditions: updated });
  }

  function handleColumnChange(index: number, columnName: string) {
    const col = columns.find((c) => c.name === columnName);
    if (!col) return;
    const validOps = operatorsForColumn(col);
    const current = filter.conditions[index];
    const op = current && validOps.includes(current.operator) ? current.operator : (validOps[0] ?? 'eq');
    updateCondition(index, { column: columnName, operator: op, value: '', values: undefined });
  }

  function handleOperatorChange(index: number, op: FilterOperator) {
    updateCondition(index, { operator: op, value: '', values: undefined });
  }

  function handleValueChange(index: number, raw: string, op: FilterOperator) {
    if (op === 'in' || op === 'notIn') {
      const values = raw.split(',').map((v) => v.trim()).filter(Boolean);
      updateCondition(index, { value: raw, values });
    } else {
      updateCondition(index, { value: raw });
    }
  }

  const selectCls =
    'h-7 rounded-sm border border-border bg-surface px-sm text-xs text-text focus:border-accent focus:outline-none';

  return (
    <div className="shrink-0 border-b border-border bg-surface p-sm">
      {filter.conditions.length === 0 ? (
        <div className="flex items-center gap-sm">
          <span className="text-xs text-text-faint">No filters applied.</span>
          <Button size="sm" variant="secondary" onClick={addCondition} disabled={columns.length === 0}>
            + Add filter
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-xs">
          {filter.conditions.map((condition, i) => {
            const col = columns.find((c) => c.name === condition.column);
            const validOps = col ? operatorsForColumn(col) : (['eq'] as FilterOperator[]);
            const hideValue = NO_VALUE_OPERATORS.has(condition.operator);

            return (
              <div key={i} className="flex flex-wrap items-center gap-xs">
                {i === 0 ? (
                  <span className="w-12 text-right text-xs text-text-faint">Where</span>
                ) : (
                  <button
                    type="button"
                    className="w-12 rounded-sm border border-border bg-surface px-1 py-0.5 text-center text-xs text-accent hover:bg-surface-hover"
                    onClick={() => emit({ ...filter, combinator: filter.combinator === 'and' ? 'or' : 'and' })}
                  >
                    {filter.combinator.toUpperCase()}
                  </button>
                )}

                <select
                  aria-label="Filter column"
                  value={condition.column}
                  onChange={(e) => handleColumnChange(i, e.target.value)}
                  className={selectCls}
                >
                  {columns.map((c) => (
                    <option key={c.name} value={c.name}>{c.name}</option>
                  ))}
                </select>

                <select
                  aria-label="Filter operator"
                  value={condition.operator}
                  onChange={(e) => handleOperatorChange(i, e.target.value as FilterOperator)}
                  className={selectCls}
                >
                  {validOps.map((op) => {
                    const label = ALL_OPERATORS.find((o) => o.value === op)?.label ?? op;
                    return <option key={op} value={op}>{label}</option>;
                  })}
                </select>

                {!hideValue ? (
                  <Input
                    aria-label="Filter value"
                    value={String(condition.value ?? '')}
                    onChange={(e) => handleValueChange(i, e.target.value, condition.operator)}
                    placeholder={condition.operator === 'in' ? 'a, b, c' : 'value'}
                    className="h-7 w-36 text-xs"
                  />
                ) : null}

                <IconButton aria-label={`Remove condition ${i + 1}`} onClick={() => removeCondition(i)}>
                  <X size={12} />
                </IconButton>
              </div>
            );
          })}

          <div className="flex items-center gap-sm pt-xs">
            <Button size="sm" variant="secondary" onClick={addCondition}>
              + Add filter
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
              Clear all
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
