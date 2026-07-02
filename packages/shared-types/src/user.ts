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

export type FontSize = 'sm' | 'md' | 'lg';
export const FONT_SIZES: FontSize[] = ['sm', 'md', 'lg'];

export type GridDensity = 'compact' | 'normal' | 'comfortable';
export const GRID_DENSITIES: GridDensity[] = ['compact', 'normal', 'comfortable'];

/** Token keys a custom palette may override — allowlisted so an upload can't inject arbitrary CSS. */
export const PALETTE_TOKEN_KEYS = ['accent', 'bg', 'surface', 'text', 'border'] as const;
export type PaletteTokenKey = (typeof PALETTE_TOKEN_KEYS)[number];

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
}
