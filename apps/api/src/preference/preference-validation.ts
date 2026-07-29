import { BadRequestException } from '@nestjs/common';
import {
  BOOLEAN_DISPLAYS,
  CHORD_PATTERN,
  COLUMN_RENDER_MODES,
  DATA_COLOR_KEYS,
  DATE_FORMATS,
  EDITOR_FONT_SIZES,
  HEX_COLOR_PATTERN,
  KEYBINDING_ACTIONS,
  LINE_NUMBER_MODES,
  MAX_PALETTE_NAME_LENGTH,
  MAX_PALETTES,
  NULL_DISPLAYS,
  PAGE_SIZES,
  PALETTE_TOKEN_KEYS,
  TAB_SIZES,
  type BehaviorPreferences,
  type ColorMode,
  type ColumnRenderOverrides,
  type ConnectionThemeOverride,
  type CustomPalette,
  type DataColorKey,
  type EditorPreferences,
  type GridDisplayPreferences,
  type KeybindingMap,
} from '@prost/shared-types';

const COLOR_MODES: ColorMode[] = ['light', 'dark', 'system'];
const ACTION_IDS = new Set(KEYBINDING_ACTIONS.map((a) => a.id));
const PALETTE_KEYS = new Set<string>(PALETTE_TOKEN_KEYS);
const RENDER_MODES = new Set<string>(COLUMN_RENDER_MODES);
const DATA_KEYS = new Set<string>(DATA_COLOR_KEYS);

function bad(message: string): never {
  throw new BadRequestException(message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates a keybinding override map: every key must be a known action id and every value a
 * well-formed chord. Conflicts (two actions sharing a chord) are intentionally **not** rejected
 * here — they're surfaced as a warning in the editor UI (principle §11) so the server stays a
 * pure shape check.
 */
export function validateKeybindings(value: unknown): KeybindingMap {
  if (!isPlainObject(value)) bad('keybindings must be an object');
  for (const [actionId, chord] of Object.entries(value)) {
    if (!ACTION_IDS.has(actionId)) bad(`Unknown keybinding action: ${actionId}`);
    if (typeof chord !== 'string' || !CHORD_PATTERN.test(chord)) {
      bad(`Invalid chord for ${actionId}: ${String(chord)}`);
    }
  }
  return value as KeybindingMap;
}

export function validateCustomPalettes(value: unknown): CustomPalette[] {
  if (!Array.isArray(value)) bad('customPalettes must be an array');
  if (value.length > MAX_PALETTES) bad(`At most ${MAX_PALETTES} custom palettes are allowed`);
  return value.map((palette) => {
    if (!isPlainObject(palette)) bad('Each palette must be an object');
    const { name, colors } = palette;
    if (typeof name !== 'string' || name.trim().length === 0) bad('Palette name is required');
    if (name.length > MAX_PALETTE_NAME_LENGTH) {
      bad(`Palette name must be ${MAX_PALETTE_NAME_LENGTH} characters or fewer`);
    }
    if (!isPlainObject(colors)) bad('Palette colors must be an object');
    for (const [key, hex] of Object.entries(colors)) {
      if (!PALETTE_KEYS.has(key)) bad(`Unknown palette color key: ${key}`);
      if (typeof hex !== 'string' || !HEX_COLOR_PATTERN.test(hex)) {
        bad(`Invalid color for ${key}: ${String(hex)}`);
      }
    }
    return { name, colors } as CustomPalette;
  });
}

/**
 * Validates the nested render-override map (`connectionId → "schema.table" → column → mode`): every
 * level must be a plain object and every leaf a known render mode. A pure shape check — no reference
 * to live connections/schemas (the server never trusts these as anything but display hints).
 */
export function validateColumnRenderOverrides(value: unknown): ColumnRenderOverrides {
  if (!isPlainObject(value)) bad('columnRenderOverrides must be an object');
  for (const tables of Object.values(value)) {
    if (!isPlainObject(tables)) bad('Each connection render-override entry must be an object');
    for (const columns of Object.values(tables)) {
      if (!isPlainObject(columns)) bad('Each table render-override entry must be an object');
      for (const mode of Object.values(columns)) {
        if (typeof mode !== 'string' || !RENDER_MODES.has(mode)) {
          bad(`Invalid column render mode: ${String(mode)}`);
        }
      }
    }
  }
  return value as ColumnRenderOverrides;
}

/**
 * Validates the data-cell tint overrides: every key must be a known `DataColorKey` and every value a
 * valid hex color. Allowlisted like palette colors so nothing arbitrary reaches the `--color-data-*` vars.
 */
export function validateDataColors(value: unknown): Partial<Record<DataColorKey, string>> {
  if (!isPlainObject(value)) bad('dataColors must be an object');
  for (const [key, hex] of Object.entries(value)) {
    if (!DATA_KEYS.has(key)) bad(`Unknown data color key: ${key}`);
    if (typeof hex !== 'string' || !HEX_COLOR_PATTERN.test(hex)) {
      bad(`Invalid color for ${key}: ${String(hex)}`);
    }
  }
  return value as Partial<Record<DataColorKey, string>>;
}

/** Small helpers for the nested-preference validators. */
function optBool(obj: Record<string, unknown>, key: string): void {
  if (obj[key] !== undefined && typeof obj[key] !== 'boolean') bad(`${key} must be a boolean`);
}
function optEnum(obj: Record<string, unknown>, key: string, allowed: readonly unknown[]): void {
  if (obj[key] !== undefined && !allowed.includes(obj[key] as never)) bad(`Invalid ${key}: ${String(obj[key])}`);
}

/** Validates the Monaco editor preference object — every field optional, each against its allow-list. */
export function validateEditorPrefs(value: unknown): EditorPreferences {
  if (!isPlainObject(value)) bad('editor must be an object');
  optEnum(value, 'fontSize', EDITOR_FONT_SIZES);
  optEnum(value, 'tabSize', TAB_SIZES);
  optBool(value, 'insertSpaces');
  optBool(value, 'wordWrap');
  optBool(value, 'minimap');
  optEnum(value, 'lineNumbers', LINE_NUMBER_MODES);
  optBool(value, 'formatOnRun');
  return value as EditorPreferences;
}

/** Validates the grid display preference object. */
export function validateGridPrefs(value: unknown): GridDisplayPreferences {
  if (!isPlainObject(value)) bad('grid must be an object');
  optEnum(value, 'nullDisplay', NULL_DISPLAYS);
  optEnum(value, 'booleanDisplay', BOOLEAN_DISPLAYS);
  optBool(value, 'rowNumbers');
  optEnum(value, 'pageSize', PAGE_SIZES);
  optEnum(value, 'dateFormat', DATE_FORMATS);
  if (value.timeZone !== undefined && typeof value.timeZone !== 'string') bad('timeZone must be a string');
  return value as GridDisplayPreferences;
}

/** Validates the query/workspace behaviour preference object. */
export function validateBehaviorPrefs(value: unknown): BehaviorPreferences {
  if (!isPlainObject(value)) bad('behavior must be an object');
  optBool(value, 'transactionByDefault');
  optBool(value, 'confirmWrites');
  optBool(value, 'restoreTabs');
  if (value.startupConnection !== undefined && typeof value.startupConnection !== 'string') {
    bad('startupConnection must be a string');
  }
  return value as BehaviorPreferences;
}

export function validateConnectionOverrides(value: unknown): Record<string, ConnectionThemeOverride> {
  if (!isPlainObject(value)) bad('connectionOverrides must be an object');
  for (const override of Object.values(value)) {
    if (!isPlainObject(override)) bad('Each connection override must be an object');
    const { accentColor, colorMode } = override;
    if (accentColor !== undefined && (typeof accentColor !== 'string' || !HEX_COLOR_PATTERN.test(accentColor))) {
      bad(`Invalid override accentColor: ${String(accentColor)}`);
    }
    if (colorMode !== undefined && !COLOR_MODES.includes(colorMode as ColorMode)) {
      bad(`Invalid override colorMode: ${String(colorMode)}`);
    }
  }
  return value as Record<string, ConnectionThemeOverride>;
}
