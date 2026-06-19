import { Calendar, Hash, KeyRound, ToggleLeft, Type } from 'lucide-react';
import type { ColDef } from 'ag-grid-community';
import type { CustomHeaderProps } from 'ag-grid-react';
import type { ColumnMetadata } from '@prost/shared-types';

export type DataTypeCategory = 'integer' | 'decimal' | 'boolean' | 'temporal' | 'string';

// Type-name sets are matched against the *normalized* form (lowercased, length/precision and
// array markers stripped) so length-qualified names like `varchar(255)` / `int(11)` / `decimal(10,2)`
// classify the same as their base type, across PostgreSQL, MySQL, and SQLite spellings.
const INTEGER_TYPES = new Set([
  'int', 'int2', 'int4', 'int8', 'integer', 'tinyint', 'smallint', 'mediumint', 'bigint',
  'serial', 'serial2', 'serial4', 'serial8', 'smallserial', 'bigserial',
]);
const DECIMAL_TYPES = new Set([
  'numeric', 'decimal', 'dec', 'fixed', 'real', 'double', 'double precision', 'float', 'float4',
  'float8', 'money', 'smallmoney',
]);
const TEMPORAL_TYPES = new Set([
  'date', 'time', 'timetz', 'timestamp', 'timestamptz', 'datetime', 'datetime2', 'smalldatetime',
  'year', 'interval', 'time with time zone', 'time without time zone', 'timestamp with time zone',
  'timestamp without time zone',
]);
const BOOLEAN_TYPES = new Set(['bool', 'boolean', 'bit']);

/** Normalizes a raw engine type name to its base form for classification. */
function normalizeType(dataType: string): string {
  return dataType
    .toLowerCase()
    .replace(/\(.*?\)/g, '') // strip length/precision: varchar(255), decimal(10,2), int(11)
    .replace(/\[\]/g, '') // strip array marker: text[]
    .replace(/\b(unsigned|zerofill|signed)\b/g, '') // MySQL numeric modifiers
    .replace(/\s+/g, ' ')
    .trim();
}

/** Buckets a data type into a coarse category so similar types share a color/icon/editor. */
export function classifyDataType(dataType: string): DataTypeCategory {
  const t = normalizeType(dataType);
  if (BOOLEAN_TYPES.has(t)) return 'boolean'; // before integer — `bit` is boolean here
  if (INTEGER_TYPES.has(t)) return 'integer';
  if (DECIMAL_TYPES.has(t)) return 'decimal';
  if (TEMPORAL_TYPES.has(t)) return 'temporal';
  return 'string';
}

const CATEGORY_COLOR_VAR: Record<DataTypeCategory, string> = {
  integer: 'var(--color-data-number)',
  decimal: 'var(--color-data-decimal)',
  boolean: 'var(--color-data-boolean)',
  temporal: 'var(--color-data-temporal)',
  string: 'var(--color-data-string)',
};

/**
 * Picks an AG Grid Community cell editor from the column's data type. The server still
 * validates/coerces every value on write (architecture principle #4) — the editor is only a
 * convenience. Returns the editor name plus any params; `undefined` falls back to the default
 * text editor.
 */
function editorForType(dataType: string): Pick<ColDef, 'cellEditor' | 'cellEditorParams'> {
  const category = classifyDataType(dataType);
  if (category === 'boolean') {
    // Tri-state: a nullable boolean can be true / false / null.
    return { cellEditor: 'agSelectCellEditor', cellEditorParams: { values: [true, false, null] } };
  }
  if (category === 'integer' || category === 'decimal') {
    return { cellEditor: 'agNumberCellEditor' };
  }
  if (normalizeType(dataType) === 'date') {
    return { cellEditor: 'agDateStringCellEditor' };
  }
  // timestamp/timestamptz/time keep the text editor — their string form round-trips losslessly,
  // unlike agDateCellEditor which is date-only. Enums lack value metadata today, so also text.
  return {};
}

export function dataTypeColorVar(dataType: string): string {
  return CATEGORY_COLOR_VAR[classifyDataType(dataType)];
}

/**
 * The column's data type rendered as a color-coded pill, tinted by `dataTypeColorVar`. Shared by
 * the grid column headers and the table Structure view so types read consistently everywhere.
 */
export function ColumnTypePill({ dataType, className }: { dataType: string; className?: string }) {
  const colorVar = dataTypeColorVar(dataType);
  return (
    <span
      className={`shrink-0 rounded-full px-1.5 py-[1px] font-sans text-[10px] font-medium ${className ?? ''}`}
      style={{ color: colorVar, backgroundColor: `color-mix(in srgb, ${colorVar} 16%, var(--color-surface))` }}
    >
      {dataType}
    </span>
  );
}

function dataTypeIcon(dataType: string) {
  switch (classifyDataType(dataType)) {
    case 'integer':
    case 'decimal':
      return Hash;
    case 'temporal':
      return Calendar;
    case 'boolean':
      return ToggleLeft;
    default:
      return Type;
  }
}

interface ColumnHeaderParams {
  dataType: string;
  isPrimaryKey: boolean;
}

function ColumnHeader({ displayName, dataType, isPrimaryKey }: CustomHeaderProps & ColumnHeaderParams) {
  const Icon = dataTypeIcon(dataType);
  return (
    <div className="flex items-center gap-xs overflow-hidden px-1 text-xs">
      {isPrimaryKey ? (
        <KeyRound size={12} className="shrink-0 text-accent" />
      ) : (
        <Icon size={12} className="shrink-0 text-text-faint" />
      )}
      <span className="truncate font-medium text-text">{displayName}</span>
      <ColumnTypePill dataType={dataType} />
    </div>
  );
}

export function buildColumnDefs(columns: ColumnMetadata[], editable = false): ColDef[] {
  return columns.map((column) => ({
    field: column.name,
    headerComponent: ColumnHeader,
    headerComponentParams: {
      dataType: column.dataType,
      isPrimaryKey: column.isPrimaryKey,
    } satisfies ColumnHeaderParams,
    cellStyle: (params) =>
      params.value === null || params.value === undefined
        ? { color: 'var(--color-data-null)', fontStyle: 'italic' }
        : { color: dataTypeColorVar(column.dataType), fontStyle: 'normal' },
    valueFormatter: (params) =>
      params.value === null || params.value === undefined ? 'null' : String(params.value),
    resizable: true,
    sortable: true,
    editable,
    // Pin-left/right from the Community column menu; presentation only (principle #5).
    lockPinned: false,
    ...(editable ? editorForType(column.dataType) : {}),
  }));
}
