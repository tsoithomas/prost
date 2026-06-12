import { useEffect, useMemo, useRef } from 'react';
import Editor, { type Monaco } from '@monaco-editor/react';
import { AgGridReact } from 'ag-grid-react';
import {
  Badge,
  PROST_DARK_THEME,
  PROST_LIGHT_THEME,
  defineProstMonacoThemes,
  prostGridTheme,
  resolveColorMode,
} from '@prost/ui';
import { buildColumnDefs } from '../grid/columnDefs';
import { orderResultsQuery, orderResultsQueryResult } from '../mocks/orderResults';
import { useThemeStore } from '../stores/themeStore';

export function SqlEditorView() {
  const columnDefs = useMemo(() => buildColumnDefs(orderResultsQueryResult.columns), []);
  const colorMode = useThemeStore((state) => state.colorMode);
  const accentColor = useThemeStore((state) => state.accentColor);
  const monacoRef = useRef<Monaco | null>(null);
  const monacoTheme = resolveColorMode(colorMode) === 'dark' ? PROST_DARK_THEME : PROST_LIGHT_THEME;

  // `defineProstMonacoThemes` snapshots the current CSS variable values, so it must be
  // re-run whenever the color mode or accent color changes to keep Monaco in sync.
  useEffect(() => {
    if (!monacoRef.current) return;
    defineProstMonacoThemes(monacoRef.current);
    monacoRef.current.editor.setTheme(monacoTheme);
  }, [colorMode, accentColor, monacoTheme]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="h-1/2 min-h-0 border-b border-border">
        <Editor
          height="100%"
          defaultLanguage="sql"
          defaultValue={orderResultsQuery}
          theme={monacoTheme}
          beforeMount={defineProstMonacoThemes}
          onMount={(_editor, monaco) => {
            monacoRef.current = monaco;
          }}
          options={{
            fontSize: 13,
            fontFamily: 'JetBrains Mono, monospace',
            minimap: { enabled: false },
            padding: { top: 8 },
          }}
        />
      </div>
      <div className="flex h-1/2 min-h-0 flex-col overflow-hidden">
        <div className="flex h-8 shrink-0 items-center gap-sm border-b border-border bg-surface px-sm">
          <Badge variant="accent">Read-only results (joined query)</Badge>
          <span className="text-xs text-text-faint">
            {orderResultsQueryResult.rows.length} rows &middot; {orderResultsQueryResult.executionTimeMs} ms
          </span>
        </div>
        <div className="min-h-0 flex-1">
          <AgGridReact theme={prostGridTheme} columnDefs={columnDefs} rowData={orderResultsQueryResult.rows} />
        </div>
      </div>
    </div>
  );
}
