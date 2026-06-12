import type * as Monaco from 'monaco-editor';

export const PROST_LIGHT_THEME = 'prost-light';
export const PROST_DARK_THEME = 'prost-dark';

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function withoutHash(hex: string): string {
  return hex.replace('#', '');
}

/**
 * Builds a Monaco theme from the current CSS custom property values. Only reads
 * plain hex tokens (not the `color-mix()`-derived accent shades) - `getComputedStyle`
 * returns the raw cascaded value for custom properties, not the resolved color, so
 * `color-mix(...)` expressions would come through as literal unparsed strings.
 */
function buildMonacoTheme(base: 'vs' | 'vs-dark'): Monaco.editor.IStandaloneThemeData {
  return {
    base,
    inherit: true,
    rules: [
      { token: 'comment', foreground: withoutHash(cssVar('--color-text-faint')), fontStyle: 'italic' },
      { token: 'keyword', foreground: withoutHash(cssVar('--color-accent')) },
      { token: 'string', foreground: withoutHash(cssVar('--color-data-string')) },
      { token: 'number', foreground: withoutHash(cssVar('--color-data-number')) },
    ],
    colors: {
      'editor.background': cssVar('--color-surface'),
      'editor.foreground': cssVar('--color-text'),
      'editorLineNumber.foreground': cssVar('--color-text-faint'),
      'editorLineNumber.activeForeground': cssVar('--color-accent'),
      'editor.lineHighlightBackground': cssVar('--color-surface-hover'),
      'editorGutter.background': cssVar('--color-surface-sunken'),
      'editor.selectionBackground': cssVar('--color-accent-muted'),
    },
  };
}

export function defineProstMonacoThemes(monaco: typeof Monaco): void {
  monaco.editor.defineTheme(PROST_LIGHT_THEME, buildMonacoTheme('vs'));
  monaco.editor.defineTheme(PROST_DARK_THEME, buildMonacoTheme('vs-dark'));
}
