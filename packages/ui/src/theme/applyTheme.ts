import type {
  ColorMode,
  CustomPalette,
  DataColorKey,
  FontFamily,
  FontSize,
  GridDensity,
  MonoFontFamily,
  PaletteTokenKey,
  RadiusScale,
} from '@prost/shared-types';
import { DATA_COLOR_KEYS, PALETTE_TOKEN_KEYS } from '@prost/shared-types';

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
// Keep in sync with the pre-paint script in `apps/web/index.html`, which applies this before React
// boots to avoid a reflow.
export const FONT_SIZE_PX: Record<FontSize, string> = {
  xs: '13px',
  sm: '14px',
  md: '16px',
  lg: '18px',
  xl: '20px',
};

/** Sets the root font size, scaling the whole rem-based UI without touching components. */
export function applyFontSize(size: FontSize): void {
  document.documentElement.style.fontSize = FONT_SIZE_PX[size];
}

interface GridDensityValues {
  /** AG Grid `spacing` — paddings + auto-calculated row/header height all scale from this. */
  spacing: string;
  fontSize: string;
}

// The middle three keep their original values so an existing preference renders identically; the
// scale grew outward at the ends rather than being re-spaced.
const GRID_DENSITY_VALUES: Record<GridDensity, GridDensityValues> = {
  tight: { spacing: '2px', fontSize: '10px' },
  compact: { spacing: '3px', fontSize: '11px' },
  normal: { spacing: '4px', fontSize: '12px' },
  comfortable: { spacing: '7px', fontSize: '13px' },
  spacious: { spacing: '9px', fontSize: '14px' },
};

/** Sets the `--grid-*` tokens the AG Grid theme reads (it re-resolves them with no JS). */
export function applyGridDensity(density: GridDensity): void {
  const root = document.documentElement;
  const v = GRID_DENSITY_VALUES[density];
  root.style.setProperty('--grid-spacing', v.spacing);
  root.style.setProperty('--grid-font-size', v.fontSize);
}

/**
 * Explicit per-density row/header height (px), passed to AG Grid as the `rowHeight`/`headerHeight`
 * grid options. AG Grid caches the theme's spacing-derived row height at init and only re-measures it
 * via a ResizeObserver, so mutating `--grid-spacing` live re-styles cell padding/font but leaves the
 * already-rendered rows at their old pixel height until reload. Setting the option makes a density
 * change apply immediately, and AG Grid derives `--ag-line-height` from it — which vertically centers
 * single-line cell text. Values mirror Quartz's default row height (`spacing * 6 + 1px`, with spacing
 * 3/4/7 from `GRID_DENSITY_VALUES`) so the look matches the auto theme.
 */
export const GRID_DENSITY_ROW_HEIGHT: Record<GridDensity, number> = {
  tight: 13,
  compact: 19,
  normal: 25,
  comfortable: 43,
  spacious: 55,
};

/** Toggles `<html data-reduce-motion>`; `tokens.css` zeroes transitions/animations when present. */
export function applyReduceMotion(on: boolean): void {
  document.documentElement.toggleAttribute('data-reduce-motion', on);
}

/**
 * Toggles `<html data-hide-focus-ring>`; `tokens.css` suppresses the `:focus-visible` outline when
 * present. An opt-out of an accessibility affordance (Phase 35) — hidden by default; turn it back
 * on in Settings › Appearance if you rely on seeing keyboard focus.
 */
export function applyHideFocusRing(on: boolean): void {
  document.documentElement.toggleAttribute('data-hide-focus-ring', on);
}

/** Concrete font stacks for each allowlisted UI-font key (`--font-sans`). */
export const FONT_FAMILY_STACK: Record<FontFamily, string> = {
  system: 'ui-sans-serif, system-ui, sans-serif',
  inter: "'Inter', ui-sans-serif, system-ui, sans-serif",
  serif: "ui-serif, Georgia, Cambria, 'Times New Roman', serif",
};

/** Concrete monospace stacks for each allowlisted editor-font key (used by `--font-mono` + Monaco). */
export const MONO_FONT_FAMILY_STACK: Record<MonoFontFamily, string> = {
  'jetbrains-mono': "'JetBrains Mono', ui-monospace, monospace",
  'system-mono': 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  'fira-code': "'Fira Code', ui-monospace, monospace",
};

/** Sets the UI font stack inline on `<html>` (`--font-sans`); `undefined` clears to the theme default. */
export function applyFontFamily(family: FontFamily | undefined): void {
  const root = document.documentElement;
  if (family) root.style.setProperty('--font-sans', FONT_FAMILY_STACK[family]);
  else root.style.removeProperty('--font-sans');
}

/**
 * Sets the monospace font stack inline on `<html>` (`--font-mono`) for non-editor mono text. The Monaco
 * editor itself reads `fontFamily` as an editor option (it snapshots computed styles), so its font is
 * threaded separately via {@link MONO_FONT_FAMILY_STACK}.
 */
export function applyMonoFontFamily(family: MonoFontFamily | undefined): void {
  const root = document.documentElement;
  if (family) root.style.setProperty('--font-mono', MONO_FONT_FAMILY_STACK[family]);
  else root.style.removeProperty('--font-mono');
}

const RADIUS_SCALE_VALUES: Record<RadiusScale, { sm: string; md: string; lg: string }> = {
  square: { sm: '0px', md: '0px', lg: '0px' },
  compact: { sm: '0px', md: '2px', lg: '4px' },
  normal: { sm: '2px', md: '4px', lg: '8px' },
  roomy: { sm: '4px', md: '8px', lg: '14px' },
  round: { sm: '6px', md: '12px', lg: '20px' },
};

/** Sets the `--radius-*` token trio inline on `<html>`; `undefined` clears to the theme default. */
export function applyRadiusScale(scale: RadiusScale | undefined): void {
  const root = document.documentElement;
  if (!scale) {
    root.style.removeProperty('--radius-sm');
    root.style.removeProperty('--radius-md');
    root.style.removeProperty('--radius-lg');
    return;
  }
  const v = RADIUS_SCALE_VALUES[scale];
  root.style.setProperty('--radius-sm', v.sm);
  root.style.setProperty('--radius-md', v.md);
  root.style.setProperty('--radius-lg', v.lg);
}

const DATA_COLOR_VAR: Record<DataColorKey, string> = {
  number: '--color-data-number',
  string: '--color-data-string',
  decimal: '--color-data-decimal',
  boolean: '--color-data-boolean',
  temporal: '--color-data-temporal',
  null: '--color-data-null',
};

/**
 * Applies data-cell tint overrides as inline `--color-data-*` vars on `<html>` (same path as the
 * palette). A missing key clears its override so the token falls back to the active mode's value.
 */
export function applyDataColors(colors: Partial<Record<DataColorKey, string>> | undefined): void {
  const root = document.documentElement;
  for (const key of DATA_COLOR_KEYS) {
    const value = colors?.[key];
    const cssVar = DATA_COLOR_VAR[key];
    if (value) root.style.setProperty(cssVar, value);
    else root.style.removeProperty(cssVar);
  }
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
