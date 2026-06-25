import { themeQuartz } from 'ag-grid-community';

/**
 * AG Grid Community Theming API accepts `var(--color-*)` strings directly and
 * re-resolves them whenever the CSS custom properties change (e.g. on `.dark` toggle
 * or accent color change), so no JS-side resolution is needed here.
 */
export const prostGridTheme = themeQuartz.withParams({
  backgroundColor: 'var(--color-surface)',
  foregroundColor: 'var(--color-text)',
  chromeBackgroundColor: 'var(--color-surface-raised)',
  headerBackgroundColor: 'var(--color-surface-raised)',
  headerTextColor: 'var(--color-text-muted)',
  headerFontWeight: 500,
  oddRowBackgroundColor: 'transparent',
  rowHoverColor: 'var(--color-surface-hover)',
  selectedRowBackgroundColor: 'var(--color-accent-muted)',
  borderColor: 'var(--color-border)',
  wrapperBorderRadius: 'var(--radius-md)',
  fontFamily: 'var(--font-mono)',
  // Density is driven by `spacing` (not a hardcoded rowHeight): AG Grid auto-calculates row +
  // header height from spacing/font, which keeps cell text vertically centered at every density.
  // Both are CSS vars (set by `applyGridDensity`) so the grid re-resolves on change with no JS.
  spacing: 'var(--grid-spacing)',
  fontSize: 'var(--grid-font-size)',
  accentColor: 'var(--color-accent)',
});
