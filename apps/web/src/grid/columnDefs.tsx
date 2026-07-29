import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, Calendar, Hash, KeyRound, ToggleLeft, Type } from 'lucide-react';
import type { ColDef, ValueFormatterParams } from 'ag-grid-community';
import type { CustomCellRendererProps, CustomHeaderProps } from 'ag-grid-react';
import type {
  BooleanDisplay,
  ColumnMetadata,
  ColumnRenderMode,
  DateFormat,
  GridDisplayPreferences,
  NullDisplay,
} from '@prost/shared-types';

export type DataTypeCategory = 'integer' | 'decimal' | 'boolean' | 'temporal' | 'string';

/** Per-column display overrides for one grid, keyed by column name (see `ColumnRenderMode`). */
export type RenderModeMap = Record<string, ColumnRenderMode>;

/** Details passed up when a user right-clicks a column header, so the grid can position the render menu. */
export interface HeaderContextMenuArgs {
  field: string;
  category: DataTypeCategory;
  x: number;
  y: number;
  /** Present only when this column is currently sorted — clears its sort (from `CustomHeaderProps.setSort`). */
  onClearSort?: () => void;
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

// Long / unbounded text-ish types that benefit from a multiline editor rather than a one-line input.
const LONG_TEXT_TYPES = new Set([
  'text', 'tinytext', 'mediumtext', 'longtext', 'citext', 'ntext', 'clob', 'json', 'jsonb', 'xml',
]);

/** True for long/unbounded text (or JSON/XML) types that warrant a multiline editor. */
export function isLongTextType(dataType: string): boolean {
  const t = normalizeType(dataType);
  return LONG_TEXT_TYPES.has(t) || t.includes('text');
}

/**
 * Picks an AG Grid Community cell editor from the column's data type. The server still
 * validates/coerces every value on write (architecture principle #4) — the editor is only a
 * convenience. Returns the editor name plus any params; `undefined` falls back to the default
 * text editor.
 */
function editorForType(dataType: string): Pick<ColDef, 'cellEditor' | 'cellEditorParams' | 'cellEditorPopup'> {
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
  if (isLongTextType(dataType)) {
    // A floating, resizable multiline textarea (see the `.ag-large-text-input` rule in tokens.css)
    // so long text / JSON is far easier to edit than a single-line input.
    return {
      cellEditor: 'agLargeTextCellEditor',
      cellEditorPopup: true,
      cellEditorParams: { maxLength: 100_000, rows: 12, cols: 60 },
    };
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

/** Resolves a stored time-zone preference to an Intl `timeZone` (undefined = the browser's local zone). */
export function resolveTimeZone(tz: string | undefined): string | undefined {
  return !tz || tz === 'local' ? undefined : tz;
}

/** Extracts the y/m/d h:m:s parts of a `Date` in `timeZone`, plus a chosen `timeZoneName` rendering. */
function zonedParts(
  date: Date,
  timeZone: string | undefined,
  tzNameStyle: 'short' | 'longOffset',
): { date: string; time: string; tz: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZone,
    timeZoneName: tzNameStyle,
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}:${get('second')}`,
    tz: get('timeZoneName'),
  };
}

/**
 * Formats a `Date` as `YYYY-MM-DD HH:MM:SS <TZ>` in the given IANA zone (undefined = the browser's
 * local zone), ending with the zone's abbreviation (e.g. `UTC`, `EST`).
 */
function formatFriendly(date: Date, timeZone: string | undefined): string {
  const { date: d, time, tz } = zonedParts(date, timeZone, 'short');
  return `${d} ${time}${tz ? ` ${tz}` : ''}`;
}

/**
 * Formats a `Date` as ISO 8601 with the zone's numeric offset (`2026-07-29T15:24:00-04:00`) in the
 * given IANA zone. `Intl`'s `longOffset` yields `GMT-04:00` (or `GMT`/empty for UTC); normalize to a
 * bare `±HH:MM` offset.
 */
function formatIso8601(date: Date, timeZone: string | undefined): string {
  const { date: d, time, tz } = zonedParts(date, timeZone, 'longOffset');
  const raw = tz.replace('GMT', '');
  const offset = /^[+-]\d{2}:\d{2}$/.test(raw) ? raw : '+00:00';
  return `${d}T${time}${offset}`;
}

// ISO 8601 (`2026-07-29T15:24:00-04:00`) and friendly (`2026-07-29 15:24:00 EDT`) date shapes.
const ISO_PARTS = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})([+-]\d{2}:\d{2}|Z)$/;
const FRIENDLY_PARTS = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?: (\S+))?$/;

export interface DateParts {
  date: string;
  time: string;
  /** ISO offset (`+00:00`) or friendly zone abbreviation (`UTC`); may be empty. */
  tz: string;
  /** `T`-separated ISO form vs. space-separated friendly form. */
  iso: boolean;
}

/** Splits a formatted date string (ISO 8601 or friendly) into its parts, or null if it isn't one. */
export function splitDateParts(text: string): DateParts | null {
  const isoMatch = ISO_PARTS.exec(text);
  if (isoMatch) return { date: isoMatch[1]!, time: isoMatch[2]!, tz: isoMatch[3]!, iso: true };
  const friendlyMatch = FRIENDLY_PARTS.exec(text);
  if (friendlyMatch) return { date: friendlyMatch[1]!, time: friendlyMatch[2]!, tz: friendlyMatch[3] ?? '', iso: false };
  return null;
}

const DATE_COLOR = 'var(--color-data-number)';
const TIME_COLOR = 'var(--color-data-boolean)';
const TZ_COLOR = 'var(--color-data-decimal)';

/**
 * Cell renderer that color-codes a formatted date — the date, time, and zone each get a distinct
 * semantic data-color (theme-aware). Handles both ISO 8601 (`T`-separated, muted `T`) and the friendly
 * `YYYY-MM-DD HH:MM:SS TZ` shape. Anything else (e.g. relative "… ago") renders plain.
 */
export function DateCell(params: CustomCellRendererProps): ReactNode {
  const text = (params.valueFormatted ?? params.value ?? '') as string;
  const parts = typeof text === 'string' ? splitDateParts(text) : null;
  if (!parts) return text;
  return (
    <span>
      <span style={{ color: DATE_COLOR }}>{parts.date}</span>
      {parts.iso ? <span style={{ color: 'var(--color-text-faint)' }}>T</span> : ' '}
      <span style={{ color: TIME_COLOR }}>{parts.time}</span>
      {parts.tz ? (
        <>
          {parts.iso ? null : ' '}
          <span style={{ color: TZ_COLOR }}>{parts.tz}</span>
        </>
      ) : null}
    </span>
  );
}

/** Human "2 hours ago"-style formatting for a `Date` (used by the `relative` date format). */
function formatRelative(date: Date): string {
  const diffMs = date.getTime() - Date.now();
  const abs = Math.abs(diffMs);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31536e6],
    ['day', 864e5],
    ['hour', 36e5],
    ['minute', 6e4],
    ['second', 1e3],
  ];
  for (const [unit, ms] of units) {
    if (abs >= ms || unit === 'second') return rtf.format(Math.round(diffMs / ms), unit);
  }
  return rtf.format(0, 'second');
}

/**
 * Formats a resolved `Date` per the `grid.dateFormat` preference, all in the configured time zone:
 * `iso` → ISO 8601 with the zone's offset; `friendly` → readable `YYYY-MM-DD HH:MM:SS <TZ>`;
 * `relative` → human "… ago".
 */
export function formatDateValue(date: Date, format: DateFormat, timeZone?: string): string {
  const tz = resolveTimeZone(timeZone);
  if (format === 'iso') return formatIso8601(date, tz);
  if (format === 'relative') return formatRelative(date);
  return formatFriendly(date, tz);
}

/**
 * Renders a numeric Unix timestamp as a readable string, honoring the `grid.dateFormat` and time-zone
 * preferences. Distinguishes seconds from milliseconds by magnitude (values ≥ 1e12 are already ms).
 * Non-numeric input is returned unchanged so a mistaken override never hides the raw value.
 */
export function formatUnixTimestamp(value: unknown, format: DateFormat = 'iso', timeZone?: string): string {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  const ms = Math.abs(n) >= 1e12 ? n : n * 1000;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return String(value);
  return formatDateValue(date, format, timeZone);
}

/**
 * Applies a render-mode display transform to a non-null cell value (JSON stays inline; the popup
 * prettifies). `date` (int-timestamp → date) observes `dateFormat`/`timeZone`; `boolean`
 * (int/text → boolean) observes `booleanDisplay`.
 */
export function applyRenderMode(value: unknown, mode: ColumnRenderMode, display: GridDisplayPreferences = {}): string {
  if (mode === 'date') return formatUnixTimestamp(value, display.dateFormat, display.timeZone);
  if (mode === 'boolean') return formatBooleanDisplay(value, display.booleanDisplay ?? 'truefalse');
  return String(value);
}

const NULL_TOKENS: Record<NullDisplay, string> = {
  null: 'null',
  parens: '(null)',
  blank: '',
  upper: 'NULL',
  symbol: '␀',
};

/** How a NULL renders per the `grid.nullDisplay` preference (defaults to the literal `null`). */
export function formatNull(display: NullDisplay | undefined): string {
  return NULL_TOKENS[display ?? 'null'];
}

/**
 * Truthiness for a boolean-ish cell value: real booleans pass through; any finite number is true
 * unless it's 0 (so an int column rendered as boolean treats 0 = false, nonzero = true); otherwise the
 * strings `t`/`true` are true and everything else (`f`/`false`/…) is false.
 */
export function isBooleanTruthy(value: unknown): boolean {
  const n = Number(value);
  return typeof value === 'boolean' ? value : Number.isFinite(n) ? n !== 0 : value === 't' || value === 'true';
}

/** Formats a boolean-ish value per `grid.booleanDisplay` (see {@link isBooleanTruthy} for truthiness). */
export function formatBooleanDisplay(value: unknown, display: BooleanDisplay): string {
  const truthy = isBooleanTruthy(value);
  if (display === 'check') return truthy ? '✓' : '✗';
  if (display === 'onezero') return truthy ? '1' : '0';
  return truthy ? 'true' : 'false';
}

/**
 * Formats a native temporal column value per `grid.dateFormat` in the configured time zone. Parses the
 * stored string and reformats it; an unparseable value is returned untouched.
 */
export function formatDateDisplay(value: unknown, display: DateFormat, timeZone?: string): string {
  const date = new Date(value as string);
  if (Number.isNaN(date.getTime())) return String(value);
  return formatDateValue(date, display, timeZone);
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
  progressSort,
  setSort,
  enableSorting,
  column,
}: CustomHeaderProps & ColumnHeaderParams) {
  const Icon = dataTypeIcon(dataType);
  const [sort, setSortDir] = useState<'asc' | 'desc' | null>(column.getSort() ?? null);

  // A custom header owns its own sort indicator: mirror the column's live sort state.
  useEffect(() => {
    const sync = () => setSortDir(column.getSort() ?? null);
    sync();
    column.addEventListener('sortChanged', sync);
    return () => column.removeEventListener('sortChanged', sync);
  }, [column]);

  return (
    <div
      className={`flex h-full w-full items-center gap-xs overflow-hidden px-1 text-xs select-none ${enableSorting ? 'cursor-pointer' : ''}`}
      aria-sort={sort === 'asc' ? 'ascending' : sort === 'desc' ? 'descending' : 'none'}
      onClick={enableSorting ? () => progressSort() : undefined}
      onContextMenu={
        onHeaderContextMenu
          ? (e) => {
              e.preventDefault();
              e.stopPropagation();
              onHeaderContextMenu({
                field,
                category,
                x: e.clientX,
                y: e.clientY,
                onClearSort: sort ? () => setSort(null) : undefined,
              });
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
      {sort === 'asc' ? (
        <ArrowUp size={12} aria-label="sorted ascending" className="ml-auto shrink-0 text-text-muted" />
      ) : sort === 'desc' ? (
        <ArrowDown size={12} aria-label="sorted descending" className="ml-auto shrink-0 text-text-muted" />
      ) : null}
    </div>
  );
}

export interface BuildColumnDefsOptions {
  /** Per-column render-as overrides (keyed by column name). */
  renderOverrides?: RenderModeMap;
  /** Called when a header is right-clicked, so the host grid can open the render-as menu. */
  onHeaderContextMenu?: (args: HeaderContextMenuArgs) => void;
  /** Global grid display preferences (null token, boolean/date formatting, wrap, row numbers). */
  display?: GridDisplayPreferences;
}

/** A leading, read-only row-number column (`grid.rowNumbers`). */
function rowNumberColDef(): ColDef {
  return {
    headerName: '#',
    colId: '__rowNumber',
    valueGetter: (p) => (p.node?.rowIndex ?? 0) + 1,
    width: 56,
    pinned: 'left',
    sortable: false,
    resizable: false,
    editable: false,
    cellStyle: { color: 'var(--color-text-faint)' },
  };
}

export function buildColumnDefs(
  columns: ColumnMetadata[],
  editable = false,
  options: BuildColumnDefsOptions = {},
): ColDef[] {
  const { renderOverrides, onHeaderContextMenu, display = {} } = options;
  const defs = columns.map((column): ColDef => {
    const mode = renderOverrides?.[column.name];
    const category = classifyDataType(column.dataType);
    // A cell renders as boolean when a boolean override is set, or (with no override) the column is a
    // native boolean type. Such cells are colored by truthiness (true = success, false = danger).
    const rendersBoolean = mode ? mode === 'boolean' : category === 'boolean';
    // A cell renders as a date (int→date override, or a native temporal column). Its formatted value
    // gets ISO part-coloring via IsoDateCell (a no-op for non-ISO formats).
    const rendersDate = mode ? mode === 'date' : category === 'temporal';
    return {
      field: column.name,
      headerComponent: ColumnHeader,
      headerComponentParams: {
        dataType: column.dataType,
        isPrimaryKey: column.isPrimaryKey,
        field: column.name,
        category,
        onHeaderContextMenu,
      } satisfies ColumnHeaderParams,
      cellStyle: (params) => {
        if (params.value === null || params.value === undefined) {
          return { color: 'var(--color-data-null)', fontStyle: 'italic' };
        }
        if (rendersBoolean) {
          return {
            color: isBooleanTruthy(params.value) ? 'var(--color-success)' : 'var(--color-danger)',
            fontStyle: 'normal',
          };
        }
        return { color: dataTypeColorVar(column.dataType), fontStyle: 'normal' };
      },
      valueFormatter: (params: ValueFormatterParams) => {
        if (params.value === null || params.value === undefined) return formatNull(display.nullDisplay);
        if (mode) return applyRenderMode(params.value, mode, display);
        // Global type-keyed formatting (only when the user has opted into a display).
        if (category === 'boolean' && display.booleanDisplay) return formatBooleanDisplay(params.value, display.booleanDisplay);
        if (category === 'temporal' && display.dateFormat) return formatDateDisplay(params.value, display.dateFormat, display.timeZone);
        return String(params.value);
      },
      // Color-code the date/time/zone parts; renders the plain value for non-date-shaped output.
      ...(rendersDate ? { cellRenderer: DateCell } : {}),
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
  return display.rowNumbers ? [rowNumberColDef(), ...defs] : defs;
}
