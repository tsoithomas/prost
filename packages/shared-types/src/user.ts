export interface UserDto {
  id: string;
  email: string;
  createdAt: string;
}

export interface QueryHistoryDto {
  id: string;
  connectionId: string;
  /** Owning connection's display name — needed for the cross-connection ("All connections") view. */
  connectionName: string;
  sql: string;
  executedAt: string;
  starred: boolean;
  label?: string;
}

/** Fields a user can change on a history entry: star it, or give it a friendly label. */
export interface UpdateHistoryRequest {
  /** `null` clears the label; `undefined` leaves it unchanged. */
  label?: string | null;
  starred?: boolean;
}

/** Query params for the bounded, server-side history search. Omitting `connectionId` = all connections. */
export interface HistoryQuery {
  search?: string;
  connectionId?: string;
  limit?: number;
}

/** A single exported history entry — SQL text + metadata only, never result data (principle §1). */
export interface HistoryExportEntry {
  sql: string;
  executedAt: string;
  connectionName: string;
  starred: boolean;
  label?: string;
}

export type ColorMode = 'light' | 'dark' | 'system';

/**
 * Five-step scales throughout. The original three keys keep their exact meaning — new steps are
 * only ever added at the ends — so a preference saved before the scale grew still resolves.
 */
export type FontSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export const FONT_SIZES: FontSize[] = ['xs', 'sm', 'md', 'lg', 'xl'];

export type GridDensity = 'tight' | 'compact' | 'normal' | 'comfortable' | 'spacious';
export const GRID_DENSITIES: GridDensity[] = ['tight', 'compact', 'normal', 'comfortable', 'spacious'];

/** Token keys a custom palette may override — allowlisted so an upload can't inject arbitrary CSS. */
export const PALETTE_TOKEN_KEYS = ['accent', 'bg', 'surface', 'text', 'border'] as const;
export type PaletteTokenKey = (typeof PALETTE_TOKEN_KEYS)[number];

/**
 * Curated font-family choices for the UI and (separately) the code editor. Allowlisted — a preference
 * carries a key, never a raw CSS `font-family` string, so nothing arbitrary reaches `<html>`/Monaco.
 * `applyFontFamily` maps each key to a concrete stack.
 */
export const FONT_FAMILIES = ['system', 'inter', 'serif'] as const;
export type FontFamily = (typeof FONT_FAMILIES)[number];

export const MONO_FONT_FAMILIES = ['jetbrains-mono', 'system-mono', 'fira-code'] as const;
export type MonoFontFamily = (typeof MONO_FONT_FAMILIES)[number];

/** Border-radius scale — maps to the `--radius-*` token trio; 'normal' is the shipped default. */
export const RADIUS_SCALES = ['square', 'compact', 'normal', 'roomy', 'round'] as const;
export type RadiusScale = (typeof RADIUS_SCALES)[number];

/**
 * Data-cell tint keys a user may override — mirror the `--color-data-*` tokens in `tokens.css`.
 * Allowlisted like `PALETTE_TOKEN_KEYS`; values are validated hex colors.
 */
export const DATA_COLOR_KEYS = ['number', 'string', 'decimal', 'boolean', 'temporal', 'null'] as const;
export type DataColorKey = (typeof DATA_COLOR_KEYS)[number];

// ---- Editor (Monaco) preferences ---------------------------------------------------------------

/** Editor font-size preset (→ px in `applyTheme`); distinct from the UI `fontSize`. */
export const EDITOR_FONT_SIZES = ['xs', 'sm', 'md', 'lg', 'xl'] as const;
export type EditorFontSize = (typeof EDITOR_FONT_SIZES)[number];

export const TAB_SIZES = [2, 4, 8] as const;
export type TabSize = (typeof TAB_SIZES)[number];

export const LINE_NUMBER_MODES = ['on', 'off', 'relative'] as const;
export type LineNumberMode = (typeof LINE_NUMBER_MODES)[number];

/** SQL-editor behaviour. Each field maps to a Monaco editor option (or the run handler for `formatOnRun`). */
export interface EditorPreferences {
  fontSize?: EditorFontSize;
  tabSize?: TabSize;
  insertSpaces?: boolean;
  wordWrap?: boolean;
  minimap?: boolean;
  lineNumbers?: LineNumberMode;
  /** Format the statement before it runs. */
  formatOnRun?: boolean;
}

// ---- Grid display preferences ------------------------------------------------------------------

/** How a NULL cell renders in the grid. */
export const NULL_DISPLAYS = ['null', 'parens', 'blank', 'upper', 'symbol'] as const;
export type NullDisplay = (typeof NULL_DISPLAYS)[number];

/** How a boolean cell renders (when no per-column render override applies). */
export const BOOLEAN_DISPLAYS = ['truefalse', 'check', 'onezero', 'yesno', 'onoff'] as const;
export type BooleanDisplay = (typeof BOOLEAN_DISPLAYS)[number];

export const PAGE_SIZES = [50, 100, 200, 500] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

/**
 * Default temporal formatting (extends the per-column `date` render mode):
 * - `iso` — ISO 8601 with the selected zone's offset (`2026-07-29T15:24:00-04:00`)
 * - `friendly` — readable `YYYY-MM-DD HH:MM:SS TZ` in the selected zone
 * - `relative` — human "… ago"
 * Both `iso` and `friendly` honor the `timeZone` preference.
 */
export const DATE_FORMATS = ['iso', 'friendly', 'relative'] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

export interface GridDisplayPreferences {
  nullDisplay?: NullDisplay;
  booleanDisplay?: BooleanDisplay;
  rowNumbers?: boolean;
  pageSize?: PageSize;
  dateFormat?: DateFormat;
  /**
   * IANA time-zone name used when rendering temporal values and int-timestamp `date` columns
   * (`'local'` or unset = the browser's zone; e.g. `'UTC'`, `'America/New_York'`).
   */
  timeZone?: string;
}

// ---- Query/workspace behaviour preferences -----------------------------------------------------

export interface BehaviorPreferences {
  /** Seed new query tabs to run inside a transaction. */
  transactionByDefault?: boolean;
  /** Require an explicit confirmation before executing a write/DDL statement. */
  confirmWrites?: boolean;
  /** Reopen the previous session's query tabs on load. */
  restoreTabs?: boolean;
  /** Auto-select a connection on startup: `'last'`, a specific connectionId, or unset for none. */
  startupConnection?: string;
}

/** Hex color (#rgb or #rrggbb), the one format accepted everywhere theming touches `<html>`. */
export const HEX_COLOR_PATTERN = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** A user-defined palette: a small, named set of token overrides (count-capped, color-validated). */
export interface CustomPalette {
  name: string;
  colors: Partial<Record<PaletteTokenKey, string>>;
}

export const MAX_PALETTES = 12;
export const MAX_PALETTE_NAME_LENGTH = 40;

/** A scoped theme applied only while a given connection is active (e.g. make "prod" visually obvious). */
export interface ConnectionThemeOverride {
  accentColor?: string;
  colorMode?: ColorMode;
}

/** A remappable action and its default chord. Shared so backend validation + frontend defaults agree. */
export interface KeybindingAction {
  id: string;
  label: string;
  defaultChord: string;
}

export const KEYBINDING_ACTIONS: KeybindingAction[] = [
  { id: 'command-palette', label: 'Open command palette', defaultChord: 'mod+k' },
  { id: 'run-statement', label: 'Run statement', defaultChord: 'mod+enter' },
  { id: 'run-all', label: 'Run all', defaultChord: 'mod+shift+enter' },
  { id: 'format-sql', label: 'Format SQL', defaultChord: 'shift+alt+f' },
  // `alt+…` chords (not `mod+t`/`mod+w`, which browsers reserve for their own tabs).
  { id: 'new-query-tab', label: 'New query tab', defaultChord: 'alt+t' },
  { id: 'close-tab', label: 'Close current tab', defaultChord: 'alt+w' },
  { id: 'show-shortcuts', label: 'Show keyboard shortcuts', defaultChord: 'shift+alt+h' },
  // Phase 40 (usability & interaction polish).
  { id: 'find-in-grid', label: 'Find in grid', defaultChord: 'mod+f' },
  { id: 'copy-cells', label: 'Copy selected cell(s)', defaultChord: 'mod+c' },
  { id: 'save-edits', label: 'Save staged edits', defaultChord: 'mod+s' },
  { id: 'next-tab', label: 'Next tab', defaultChord: 'alt+pagedown' },
  { id: 'prev-tab', label: 'Previous tab', defaultChord: 'alt+pageup' },
  { id: 'focus-editor', label: 'Focus SQL editor', defaultChord: 'alt+1' },
  { id: 'focus-results', label: 'Focus results grid', defaultChord: 'alt+2' },
  { id: 'toggle-left-sidebar', label: 'Toggle left sidebar', defaultChord: 'alt+b' },
  { id: 'toggle-ai-sidebar', label: 'Toggle AI sidebar', defaultChord: 'alt+j' },
  { id: 'toggle-focus-mode', label: 'Toggle focus mode', defaultChord: 'alt+enter' },
  { id: 'refresh-view', label: 'Refresh current view', defaultChord: 'alt+r' },
];

/** actionId → chord. Holds **overrides only**; consumers merge over `KEYBINDING_ACTIONS` defaults. */
export type KeybindingMap = Record<string, string>;

/** Chord grammar: zero+ modifiers (`mod`/`ctrl`/`cmd`/`shift`/`alt`) then one key, joined by `+`. */
export const CHORD_PATTERN = /^(mod|ctrl|cmd|shift|alt)(\+(mod|ctrl|cmd|shift|alt))*\+[a-z0-9]+$/;

/**
 * A per-column display override chosen from a grid header's right-click menu. Purely presentational —
 * the underlying value is untouched:
 * - `date`: a numeric Unix epoch is rendered as a human-readable date string.
 * - `boolean`: a numeric/boolean is rendered as `True`/`False`.
 * - `json`: a string is treated as JSON — selecting the cell opens a prettified popup.
 */
export type ColumnRenderMode = 'date' | 'boolean' | 'json';

export const COLUMN_RENDER_MODES: ColumnRenderMode[] = ['date', 'boolean', 'json'];

/**
 * Per-column render overrides, keyed `connectionId → "schema.table" → columnName → mode`. Only
 * grids with a stable table identity persist here; ad-hoc query results are session-only.
 */
export type ColumnRenderOverrides = Record<string, Record<string, Record<string, ColumnRenderMode>>>;

/**
 * Columns the user marked sensitive, keyed `connectionId → "schema.table" → column names` (Phase 39).
 * Identifiers only — no target row data is ever persisted (principle §1).
 *
 * This is a **display/export transform, not access control**: the server redacts these columns in grid
 * reads and exports so they can't leak incidentally (a shared screen, a handed-over CSV), but the same
 * user can reveal them, and query results are never masked.
 */
export type MaskedColumns = Record<string, Record<string, string[]>>;

/** What a redacted value is replaced with. Never a partial value — no format-preserving leak. */
export const MASK_TOKEN = '••••';

/** Caps on the masking preference, so one user's config can't grow unbounded. */
export const MAX_MASKED_TABLES = 500;
export const MAX_MASKED_COLUMNS_PER_TABLE = 100;

export interface UserPreferenceDto {
  colorMode: ColorMode;
  accentColor: string;
  fontSize: FontSize;
  gridDensity: GridDensity;
  /** Keybinding overrides (merged over `KEYBINDING_ACTIONS` defaults on the client). */
  keybindings: KeybindingMap;
  customPalettes: CustomPalette[];
  /** Per-connection theme overrides, keyed by connectionId. */
  connectionOverrides: Record<string, ConnectionThemeOverride>;
  /** Per-column "render as" display overrides (see `ColumnRenderOverrides`). */
  columnRenderOverrides: ColumnRenderOverrides;
  /** Columns marked sensitive, redacted server-side in grid reads + exports (see `MaskedColumns`). */
  maskedColumns: MaskedColumns;
  /** UI font family (allowlisted key, not a raw stack); omitted = the shipped default. */
  fontFamily?: FontFamily;
  /** Code-editor (monospace) font family; omitted = the shipped default. */
  monoFontFamily?: MonoFontFamily;
  /** Border-radius scale; omitted = 'normal'. */
  radiusScale?: RadiusScale;
  /** Overrides for the grid data-cell tints (`--color-data-*`); validated hex per key. */
  dataColors?: Partial<Record<DataColorKey, string>>;
  /** SQL-editor (Monaco) preferences. */
  editor?: EditorPreferences;
  /** Grid display preferences. */
  grid?: GridDisplayPreferences;
  /** Query/workspace behaviour preferences. */
  behavior?: BehaviorPreferences;
  /** Disable UI transitions/animations. */
  reduceMotion?: boolean;
  /**
   * Hide the visible keyboard-focus ring (Phase 35's `:focus-visible` outline). Omitted/true = hidden
   * (the default). This is an opt-out of an accessibility affordance for keyboard/screen-reader
   * users — turn it back on (set to `false`) if you rely on seeing keyboard focus.
   */
  hideFocusRing?: boolean;
  /** Whether the AI assistant is available; omitted/true = enabled. */
  aiEnabled?: boolean;
}
