import { Calendar, Hash, KeyRound, ToggleLeft, Type } from 'lucide-react';
import type { ColDef, ValueFormatterParams } from 'ag-grid-community';
import type { CustomHeaderProps } from 'ag-grid-react';
import type { ColumnMetadata, ColumnRenderMode } from '@prost/shared-types';

export type DataTypeCategory = 'integer' | 'decimal' | 'boolean' | 'temporal' | 'string';

/** Per-column display overrides for one grid, keyed by column name (see `ColumnRenderMode`). */
export type RenderModeMap = Record<string, ColumnRenderMode>;

/** Details passed up when a user right-clicks a column header, so the grid can position the render menu. */
export interface HeaderContextMenuArgs {
  field: string;
  category: DataTypeCategory;
  x: number;
  y: number;
}

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

/** The "render as" modes offered for a column of this category (empty = no override options). */
export function availableRenderModes(category: DataTypeCategory): ColumnRenderMode[] {
  if (category === 'integer' || category === 'decimal') return ['date', 'boolean'];
  if (category === 'string') return ['json'];
  return [];
}

/**
 * Renders a numeric Unix timestamp as a readable UTC string. Distinguishes seconds from milliseconds
 * by magnitude (values ≥ 1e12 are already ms — that threshold is ~2001 in ms / year 33658 in seconds).
 * Non-numeric input is returned unchanged so a mistaken override never hides the raw value.
 */
export function formatUnixTimestamp(value: unknown): string {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  const ms = Math.abs(n) >= 1e12 ? n : n * 1000;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return String(value);
  return `${date.toISOString().slice(0, 19).replace('T', ' ')} UTC`;
}

/** Renders a numeric/boolean as `True`/`False` (0 and `false` are False; everything else True). */
export function formatRenderBoolean(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  const n = Number(value);
  if (Number.isFinite(n)) return n !== 0 ? 'True' : 'False';
  return String(value);
}

/** Applies a render-mode display transform to a non-null cell value (JSON stays inline; the popup prettifies). */
export function applyRenderMode(value: unknown, mode: ColumnRenderMode): string {
  if (mode === 'date') return formatUnixTimestamp(value);
  if (mode === 'boolean') return formatRenderBoolean(value);
  return String(value);
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
  field: string;
  category: DataTypeCategory;
  onHeaderContextMenu?: (args: HeaderContextMenuArgs) => void;
}

function ColumnHeader({
  displayName,
  dataType,
  isPrimaryKey,
  field,
  category,
  onHeaderContextMenu,
}: CustomHeaderProps & ColumnHeaderParams) {
  const Icon = dataTypeIcon(dataType);
  return (
    <div
      className="flex items-center gap-xs overflow-hidden px-1 text-xs"
      onContextMenu={
        onHeaderContextMenu
          ? (e) => {
              e.preventDefault();
              e.stopPropagation();
              onHeaderContextMenu({ field, category, x: e.clientX, y: e.clientY });
            }
          : undefined
      }
    >
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

export interface BuildColumnDefsOptions {
  /** Per-column render-as overrides (keyed by column name). */
  renderOverrides?: RenderModeMap;
  /** Called when a header is right-clicked, so the host grid can open the render-as menu. */
  onHeaderContextMenu?: (args: HeaderContextMenuArgs) => void;
}

export function buildColumnDefs(
  columns: ColumnMetadata[],
  editable = false,
  options: BuildColumnDefsOptions = {},
): ColDef[] {
  const { renderOverrides, onHeaderContextMenu } = options;
  return columns.map((column) => {
    const mode = renderOverrides?.[column.name];
    return {
      field: column.name,
      headerComponent: ColumnHeader,
      headerComponentParams: {
        dataType: column.dataType,
        isPrimaryKey: column.isPrimaryKey,
        field: column.name,
        category: classifyDataType(column.dataType),
        onHeaderContextMenu,
      } satisfies ColumnHeaderParams,
      cellStyle: (params) =>
        params.value === null || params.value === undefined
          ? { color: 'var(--color-data-null)', fontStyle: 'italic' }
          : { color: dataTypeColorVar(column.dataType), fontStyle: 'normal' },
      valueFormatter: (params: ValueFormatterParams) => {
        if (params.value === null || params.value === undefined) return 'null';
        return mode ? applyRenderMode(params.value, mode) : String(params.value);
      },
      resizable: true,
      sortable: true,
      // Two-state cycle: a click sorts ascending, the next flips to descending (no tri-state "none").
      sortingOrder: ['asc', 'desc'],
      // An edited cell round-trips the raw underlying value, so a render override disables editing for
      // that column (the display transform isn't reversible on write).
      editable: editable && !mode,
      // Pin-left/right from the Community column menu; presentation only (principle #5).
      lockPinned: false,
      ...(editable && !mode ? editorForType(column.dataType) : {}),
    };
  });
}
