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
  fontSize: 12,
  cellHorizontalPadding: 8,
  rowHeight: 24,
  headerHeight: 24,
  accentColor: 'var(--color-accent)',
});
