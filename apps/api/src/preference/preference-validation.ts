import { BadRequestException } from '@nestjs/common';
import {
  CHORD_PATTERN,
  COLUMN_RENDER_MODES,
  HEX_COLOR_PATTERN,
  KEYBINDING_ACTIONS,
  MAX_PALETTE_NAME_LENGTH,
  MAX_PALETTES,
  PALETTE_TOKEN_KEYS,
  type ColorMode,
  type ColumnRenderOverrides,
  type ConnectionThemeOverride,
  type CustomPalette,
  type KeybindingMap,
} from '@prost/shared-types';

const COLOR_MODES: ColorMode[] = ['light', 'dark', 'system'];
const ACTION_IDS = new Set(KEYBINDING_ACTIONS.map((a) => a.id));
const PALETTE_KEYS = new Set<string>(PALETTE_TOKEN_KEYS);
const RENDER_MODES = new Set<string>(COLUMN_RENDER_MODES);

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
