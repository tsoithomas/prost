import type { ColorMode } from '@prost/shared-types';

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
