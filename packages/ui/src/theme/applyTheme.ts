import type {
  ColorMode,
  CustomPalette,
  FontSize,
  GridDensity,
  PaletteTokenKey,
} from '@prost/shared-types';
import { PALETTE_TOKEN_KEYS } from '@prost/shared-types';

export function resolveColorMode(mode: ColorMode): 'light' | 'dark' {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return mode;
}

/** Toggles the `.dark` class on `<html>`, resolving `system` against the OS preference. */
export function applyColorMode(mode: ColorMode): void {
  document.documentElement.classList.toggle('dark', resolveColorMode(mode) === 'dark');
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace('#', '');
  const expanded =
    normalized.length === 3
      ? normalized
          .split('')
          .map((c) => c + c)
          .join('')
      : normalized;
  const int = parseInt(expanded, 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

function srgbChannelToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return (
    0.2126 * srgbChannelToLinear(r) + 0.7152 * srgbChannelToLinear(g) + 0.0722 * srgbChannelToLinear(b)
  );
}

/**
 * Picks black or white text, whichever yields the higher WCAG contrast ratio against
 * `hex`. A simple luminance threshold (e.g. > 0.5) picks the wrong color for highly
 * saturated blues, where black text contrasts better despite the color "feeling" dark.
 */
export function contrastingTextColor(hex: string): '#000000' | '#ffffff' {
  const luminance = relativeLuminance(hex);
  const contrastWithWhite = 1.05 / (luminance + 0.05);
  const contrastWithBlack = (luminance + 0.05) / 0.05;
  return contrastWithBlack >= contrastWithWhite ? '#000000' : '#ffffff';
}

/** Sets `--color-accent` (and its derived `--color-accent-fg`) on `<html>`. */
export function applyAccentColor(value: string, fg?: string): void {
  const root = document.documentElement;
  root.style.setProperty('--color-accent', value);
  root.style.setProperty('--color-accent-fg', fg ?? contrastingTextColor(value));
}

/** Maps the named font-size preference to a root `font-size` (Tailwind `text-*` are rem-based). */
export const FONT_SIZE_PX: Record<FontSize, string> = { sm: '14px', md: '16px', lg: '18px' };

/** Sets the root font size, scaling the whole rem-based UI without touching components. */
export function applyFontSize(size: FontSize): void {
  document.documentElement.style.fontSize = FONT_SIZE_PX[size];
}

interface GridDensityValues {
  /** AG Grid `spacing` — paddings + auto-calculated row/header height all scale from this. */
  spacing: string;
  fontSize: string;
}

const GRID_DENSITY_VALUES: Record<GridDensity, GridDensityValues> = {
  compact: { spacing: '3px', fontSize: '11px' },
  normal: { spacing: '4px', fontSize: '12px' },
  comfortable: { spacing: '7px', fontSize: '13px' },
};

/** Sets the `--grid-*` tokens the AG Grid theme reads (it re-resolves them with no JS). */
export function applyGridDensity(density: GridDensity): void {
  const root = document.documentElement;
  const v = GRID_DENSITY_VALUES[density];
  root.style.setProperty('--grid-spacing', v.spacing);
  root.style.setProperty('--grid-font-size', v.fontSize);
}

const PALETTE_TOKEN_VAR: Record<PaletteTokenKey, string> = {
  accent: '--color-accent',
  bg: '--color-bg',
  surface: '--color-surface',
  text: '--color-text',
  border: '--color-border',
};

/**
 * Applies a custom palette's color keys as inline `--color-*` overrides on `<html>` (same path
 * as the accent). Passing `undefined` (or a palette missing a key) clears the override so the
 * token falls back to the active mode's value. Also keeps `--color-accent-fg` in sync.
 */
export function applyCustomPalette(palette: CustomPalette | undefined): void {
  const root = document.documentElement;
  for (const key of PALETTE_TOKEN_KEYS) {
    const value = palette?.colors[key];
    const cssVar = PALETTE_TOKEN_VAR[key];
    if (value) {
      root.style.setProperty(cssVar, value);
    } else {
      root.style.removeProperty(cssVar);
    }
  }
  const accent = palette?.colors.accent;
  if (accent) {
    root.style.setProperty('--color-accent-fg', contrastingTextColor(accent));
  }
}
