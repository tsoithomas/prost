import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import Editor, { type Monaco, type OnMount } from '@monaco-editor/react';
import { AgGridReact } from 'ag-grid-react';
import type {
  CellClickedEvent,
  CellValueChangedEvent,
  GetRowIdParams,
  GridApi,
  GridReadyEvent,
  IDatasource,
  SelectionChangedEvent,
} from 'ag-grid-community';
import { Bookmark, Download, Play, Plus, Save, Trash2, WandSparkles, X } from 'lucide-react';
import { format } from 'sql-formatter';
import type { ColumnRenderMode, DbEngineDescriptor, ExecuteQueryResponse, QueryPlanResult } from '@prost/shared-types';
import {
  Badge,
  Button,
  Switch,
  GRID_DENSITY_ROW_HEIGHT,
  IconButton,
  Input,
  MONO_FONT_FAMILY_STACK,
  PROST_DARK_THEME,
  PROST_LIGHT_THEME,
  Toast,
  defineFreshProstMonacoTheme,
  defineProstMonacoThemes,
  prostGridTheme,
  resolveColorMode,
} from '@prost/ui';
import { useActiveConnection } from '../api/connections';
import { useDeleteRow, useInsertRow, useUpdateCell } from '../api/grid';
import { useEngineDescriptor } from '../api/databaseEngines';
import { useMetadata } from '../api/metadata';
import { useUpdatePreferences } from '../api/preferences';
import { useExecuteQuery, useExplainQuery } from '../api/query';
import { useCreateSnippet } from '../api/snippets';
import { buildColumnDefs, type HeaderContextMenuArgs, type RenderModeMap } from '../grid/columnDefs';
import { ColumnRenderMenu } from '../grid/ColumnRenderMenu';
import { JsonCellPopup } from '../grid/JsonCellPopup';
import { useConfirm } from '../hooks/useConfirm';
import { useToasts } from '../hooks/useToasts';
import { matchesChord, resolveBinding } from '../keybindings';
import { ApiError, apiErrorDetail, apiErrorMessage } from '../lib/apiClient';
import { useConnectionStore } from '../stores/connectionStore';
import { useThemeStore } from '../stores/themeStore';
import { INITIAL_SQL, useWorkspaceStore } from '../stores/workspaceStore';
import { createCursorDatasource } from './cursorDatasource';
import { createQueryPageDatasource } from './queryPageDatasource';
import { PlanPanel, StatementResultPanel } from './StatementResultPanel';
import { QueryPlanView } from './QueryPlanView';
import { ResultChartPanel } from './ResultChartPanel';
import { ExportDialog } from './ExportDialog';
import { statementAtOffset } from './statementRanges';
import { isLikelyWrite } from './writeClassifier';
import { useMonacoCompletions } from './useMonacoCompletions';
import { FixWithAiButton } from '../ai/FixWithAiButton';
import { SchemaSuggestionList } from '../ddl/SchemaSuggestionList';
import { useSchemaSuggestions } from '../ddl/useSchemaSuggestions';

/** AG Grid infinite-model block size for editor query results (matches the server page size). */
const PAGE_SIZE = 100;

/** Editor font-size preset → px. */
const EDITOR_FONT_PX = { sm: 12, md: 13, lg: 15 } as const;

/** `sourceTable` is `schema.table` (see `editability.ts`) — split it back for the Phase 2 mutation hooks. */
function splitSourceTable(sourceTable: string | undefined): { schema: string; table: string } | null {
  if (!sourceTable) return null;
  const dot = sourceTable.indexOf('.');
  if (dot === -1) return null;
  return { schema: sourceTable.slice(0, dot), table: sourceTable.slice(dot + 1) };
}

export function formatterLanguage(
  descriptor?: DbEngineDescriptor,
): 'postgresql' | 'mysql' | 'sqlite' {
  return descriptor?.formatterDialect ?? 'postgresql';
}

export function SqlEditorView() {
  const connectionId = useConnectionStore((state) => state.activeConnectionId);
  const activeConnection = useActiveConnection();
  const descriptor = useEngineDescriptor(connectionId);
  const colorMode = useThemeStore((state) => state.colorMode);
  const accentColor = useThemeStore((state) => state.accentColor);
  // Palettes recolor the editor's CSS vars without touching colorMode/accentColor, so the Monaco
  // re-theme effect must also watch them (a palette snapshot is what Monaco reads via getComputedStyle).
  const activePaletteName = useThemeStore((state) => state.activePaletteName);
  const customPalettes = useThemeStore((state) => state.customPalettes);
  const monoFontFamily = useThemeStore((state) => state.monoFontFamily);
  const gridDensity = useThemeStore((state) => state.gridDensity);
  const gridRowHeight = GRID_DENSITY_ROW_HEIGHT[gridDensity];
  const editorPrefs = useThemeStore((state) => state.editor);
  const gridPrefs = useThemeStore((state) => state.grid);
  const pageSize = gridPrefs.pageSize ?? PAGE_SIZE;
  const confirmWrites = useThemeStore((state) => state.behavior.confirmWrites ?? false);
  const pendingQuerySql = useWorkspaceStore((state) => state.pendingQuerySql);
  const clearPendingQuerySql = useWorkspaceStore((state) => state.clearPendingQuerySql);
  const setCursorPosition = useWorkspaceStore((state) => state.setCursorPosition);
  const activeTabId = useWorkspaceStore((state) => state.activeTabId);
  const activeTab = useWorkspaceStore((state) => state.tabs.find((tab) => tab.id === state.activeTabId));
  const setTabSql = useWorkspaceStore((state) => state.setTabSql);
  const setTabResult = useWorkspaceStore((state) => state.setTabResult);
  const setTabTransactional = useWorkspaceStore((state) => state.setTabTransactional);
  const transactionalDefault = useWorkspaceStore((state) => state.transactionalDefault);
  const queryClient = useQueryClient();
  const monacoTheme = resolveColorMode(colorMode) === 'dark' ? PROST_DARK_THEME : PROST_LIGHT_THEME;
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const gridApiRef = useRef<GridApi | null>(null);
  const formatterDialectRef = useRef<'postgresql' | 'mysql' | 'sqlite'>('postgresql');
  formatterDialectRef.current = formatterLanguage(descriptor);
  const [monacoInstance, setMonacoInstance] = useState<Monaco | null>(null);
  // The editor's live theme name. Starts as the fixed pair (defined at beforeMount); every theme
  // change swaps it for a freshly-snapshotted, uniquely-named theme so Monaco actually repaints.
  const [monacoThemeName, setMonacoThemeName] = useState(monacoTheme);

  const sql = activeTab?.sql ?? INITIAL_SQL;
  // A tab that hasn't been explicitly toggled follows the persisted default (survives reloads).
  const transactional = activeTab?.transactional ?? transactionalDefault;
  const [saveSnippetName, setSaveSnippetName] = useState<string | null>(null);
  const [response, setResponse] = useState<ExecuteQueryResponse | null>(activeTab?.result ?? null);
  // Structured query plan (Phase 26). When set, it takes over the results slot; cleared on run/tab-switch.
  const [planResult, setPlanResult] = useState<QueryPlanResult | null>(null);
  // The statement the current plan came from — grounds the Phase 33 index suggestions in the same
  // query the user explained.
  const [planSql, setPlanSql] = useState('');
  // Bumped on every run / tab switch so the infinite grid rebuilds its datasource + cache for
  // the new result (used in the grid `key`).
  const [resultEpoch, setResultEpoch] = useState(0);
  // Results lens for a single rows result: the grid, or a client-side chart over the loaded page
  // (Phase 29). Reset to 'grid' on every new result / tab switch.
  const [resultView, setResultView] = useState<'grid' | 'chart'>('grid');
  const [exportOpen, setExportOpen] = useState(false);
  const [pendingInsert, setPendingInsert] = useState<Record<string, unknown> | null>(null);
  const [selectedRows, setSelectedRows] = useState<Record<string, unknown>[]>([]);
  // When a streamed result hits the server-side row budget, the count of rows actually delivered.
  const [streamTruncatedAt, setStreamTruncatedAt] = useState<number | null>(null);
  // The streaming cursor expired mid-scroll and the grid fell back to offset paging.
  const [streamReaped, setStreamReaped] = useState(false);
  const [renderMenu, setRenderMenu] = useState<HeaderContextMenuArgs | null>(null);
  const [jsonCell, setJsonCell] = useState<{ column: string; value: unknown } | null>(null);
  // Ad-hoc query results without a stable table identity keep render overrides in-session only.
  const [ephemeralRenderOverrides, setEphemeralRenderOverrides] = useState<RenderModeMap>({});
  const { toasts, push: pushToast, dismiss: dismissToast } = useToasts();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const createSnippet = useCreateSnippet();

  const executeQuery = useExecuteQuery(connectionId ?? '');
  const explainQuery = useExplainQuery(connectionId ?? '');
  const suggest = useSchemaSuggestions(connectionId);
  // Stable reference, so `runExplain` can depend on it honestly (a fresh plan clears stale advice).
  const resetSuggestions = suggest.reset;
  const { data: schemaMetadata } = useMetadata(connectionId);
  useMonacoCompletions(monacoInstance, schemaMetadata);

  const statements = response?.statements ?? [];
  const single = statements.length === 1 ? statements[0]! : null;
  const editableResult = single?.kind === 'rows' ? single : null;

  const sourceTable = editableResult ? splitSourceTable(editableResult.sourceTable) : null;
  const updateCell = useUpdateCell(connectionId ?? '', sourceTable?.schema ?? '', sourceTable?.table ?? '');
  const insertRow = useInsertRow(connectionId ?? '', sourceTable?.schema ?? '', sourceTable?.table ?? '');
  const deleteRow = useDeleteRow(connectionId ?? '', sourceTable?.schema ?? '', sourceTable?.table ?? '');

  // A read-only connection disables inline editing even when the result itself is analyzable as
  // editable — writes would be rejected server-side anyway (Phase 25).
  const writable = !activeConnection?.capabilities.readOnly;
  const editable = (editableResult?.editable ?? false) && writable;
  const primaryKey = editableResult?.primaryKey ?? [];
  const isGridResult = editableResult !== null;

  // Render-as overrides: server-backed for results with a real table identity, session-only otherwise.
  const persistedTableKey = editableResult?.sourceTable;
  const persistedRenderOverrides = useThemeStore((state) =>
    connectionId && persistedTableKey ? state.columnRenderOverrides[connectionId]?.[persistedTableKey] : undefined,
  );
  const setColumnRenderOverride = useThemeStore((state) => state.setColumnRenderOverride);
  const updatePreferences = useUpdatePreferences();
  const renderOverrides = persistedTableKey ? persistedRenderOverrides : ephemeralRenderOverrides;

  const columnDefs = useMemo(
    () =>
      editableResult
        ? buildColumnDefs(editableResult.columns, editable, { renderOverrides, onHeaderContextMenu: setRenderMenu, display: gridPrefs })
        : [],
    [editableResult, editable, renderOverrides, gridPrefs],
  );

  const handleSelectRenderMode = useCallback(
    (mode: ColumnRenderMode | null) => {
      if (!renderMenu) return;
      if (connectionId && persistedTableKey) {
        const next = setColumnRenderOverride(connectionId, persistedTableKey, renderMenu.field, mode);
        updatePreferences.mutate(
          { columnRenderOverrides: next },
          { onError: (error) => pushToast('danger', apiErrorDetail(error, 'Failed to save display preference.')) },
        );
      } else {
        setEphemeralRenderOverrides((prev) => {
          const next = { ...prev };
          if (mode) next[renderMenu.field] = mode;
          else delete next[renderMenu.field];
          return next;
        });
      }
    },
    [renderMenu, connectionId, persistedTableKey, setColumnRenderOverride, updatePreferences, pushToast],
  );

  const onCellClicked = useCallback(
    (event: CellClickedEvent) => {
      const colId = event.column.getColId();
      if (renderOverrides?.[colId] === 'json') setJsonCell({ column: colId, value: event.value });
    },
    [renderOverrides],
  );

  const getRowId = useMemo(() => {
    if (primaryKey.length === 0) return undefined;
    return (params: GetRowIdParams) => primaryKey.map((column) => String(params.data[column])).join('::');
  }, [primaryKey]);

  const pinnedTopRowData = useMemo(() => (pendingInsert ? [pendingInsert] : undefined), [pendingInsert]);

  // Infinite-scroll datasource. Small/normal results keep the offset path (`/query/page`); a
  // *truncated* result on a cursor-capable engine streams via a forward-only server cursor
  // (`createCursorDatasource`) so deep scrolling doesn't re-scan with a growing OFFSET. Rebuilt
  // whenever the result changes (`resultEpoch`) so the grid `key` swap gets a fresh datasource + cache.
  const useCursor = (editableResult?.truncated ?? false) && (descriptor?.supportsCursors ?? false);
  const datasource = useMemo<IDatasource | undefined>(() => {
    if (!connectionId || editableResult === null) return undefined;
    if (useCursor) {
      return createCursorDatasource({
        connectionId,
        sql: editableResult.sql,
        onError: (error) => pushToast('danger', apiErrorDetail(error, 'Failed to load more rows.')),
        onTruncated: (rowsServed) => setStreamTruncatedAt(rowsServed),
        onReaped: () => setStreamReaped(true),
      });
    }
    return createQueryPageDatasource({
      connectionId,
      sql: editableResult.sql,
      onError: (error) => pushToast('danger', apiErrorDetail(error, 'Failed to load more rows.')),
    });
    // `resultEpoch` is an intentional dependency: a re-run of the same SQL must rebuild the datasource.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, editableResult?.sql, useCursor, resultEpoch, pushToast]);

  // `defineProstMonacoThemes` snapshots the current CSS variable values, so it must be
  // re-run whenever the color mode or accent color changes to keep Monaco in sync.
  useEffect(() => {
    const monaco = monacoInstance;
    if (!monaco) return;
    // Snapshot the current CSS tokens into a fresh, uniquely-named theme and switch to it. A new name
    // each time is what makes Monaco repaint an existing editor (redefining the active name doesn't).
    const name = defineFreshProstMonacoTheme(monaco, resolveColorMode(colorMode) === 'dark' ? 'dark' : 'light');
    monaco.editor.setTheme(name);
    setMonacoThemeName(name);
  }, [monacoInstance, colorMode, accentColor, activePaletteName, customPalettes]);

  // Apply editor font family/size imperatively. Relying on @monaco-editor/react's `options` prop is
  // unreliable for fonts — Monaco caches glyph metrics, so the change doesn't repaint until fonts are
  // re-measured. Setting the options on the instance and then calling `remeasureFonts()` in one ordered
  // step guarantees the new font takes effect immediately.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !monacoInstance) return;
    editor.updateOptions({
      fontFamily: monoFontFamily ? MONO_FONT_FAMILY_STACK[monoFontFamily] : 'JetBrains Mono, monospace',
      fontSize: EDITOR_FONT_PX[editorPrefs.fontSize ?? 'md'],
    });
    monacoInstance.editor.remeasureFonts();
  }, [monacoInstance, monoFontFamily, editorPrefs.fontSize]);

  // Switching tabs swaps the editor buffer + results to that tab's stored state and
  // clears any in-progress edit/selection UI from the previous tab.
  useEffect(() => {
    const storedSql = activeTab?.sql ?? INITIAL_SQL;
    const storedResponse = activeTab?.result ?? null;
    editorRef.current?.setValue(storedSql);
    setResponse(storedResponse);
    setResultEpoch((e) => e + 1);
    setResultView('grid');
    setPendingInsert(null);
    setSelectedRows([]);
    setSaveSnippetName(null);
    setStreamTruncatedAt(null);
    setStreamReaped(false);
    setEphemeralRenderOverrides({});
    setRenderMenu(null);
    setJsonCell(null);
    setPlanResult(null);
  }, [activeTabId]);

  // Loading a query from history sets `pendingQuerySql` (see `workspaceStore.loadQuery`);
  // consume it into the editor buffer and clear it so it doesn't reapply on remount.
  useEffect(() => {
    if (pendingQuerySql === null) return;
    editorRef.current?.setValue(pendingQuerySql);
    setTabSql(activeTabId, pendingQuerySql);
    clearPendingQuerySql();
  }, [pendingQuerySql, clearPendingQuerySql, activeTabId, setTabSql]);

  const runSql = useCallback(
    async (sqlToRun: string) => {
      let trimmed = sqlToRun.trim();
      if (!connectionId || !trimmed || executeQuery.isPending) return;

      // "Format on run": tidy the statement before executing (and recording in history). Best-effort —
      // fall back to the original text if the formatter can't parse it.
      if (editorPrefs.formatOnRun) {
        try {
          trimmed = format(trimmed, { language: formatterDialectRef.current }).trim();
        } catch {
          /* keep the original text */
        }
      }

      // "Confirm writes": ask before running a statement that looks like it modifies data or schema.
      if (confirmWrites && isLikelyWrite(trimmed)) {
        const ok = await confirm({
          title: 'Run this statement?',
          description: 'This looks like it modifies data or schema.',
          confirmLabel: 'Run',
          danger: true,
        });
        if (!ok) return;
      }

      setPendingInsert(null);
      setSelectedRows([]);
      setPlanResult(null);
      gridApiRef.current?.deselectAll();

      executeQuery.mutate(
        { sql: trimmed, transactional },
        {
          onSuccess: (data) => {
            setResponse(data);
            setResultEpoch((e) => e + 1);
            setResultView('grid');
            setStreamTruncatedAt(null);
            setStreamReaped(false);
            setEphemeralRenderOverrides({});
            setTabResult(activeTabId, data);
            queryClient.invalidateQueries({ queryKey: ['history', connectionId] });
          },
        },
      );
    },
    [connectionId, executeQuery, transactional, queryClient, activeTabId, setTabResult, editorPrefs, confirmWrites, confirm],
  );

  // The selected text if any, otherwise the statement under the cursor, otherwise the whole buffer.
  const resolveActiveStatement = useCallback((): string => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model) return sql;
    const selection = editor.getSelection();
    if (selection && !selection.isEmpty()) return model.getValueInRange(selection);
    const position = editor.getPosition();
    const text = model.getValue();
    const offset = position ? model.getOffsetAt(position) : text.length;
    return statementAtOffset(text, offset) ?? text;
  }, [sql]);

  // Cmd/Ctrl+Enter: run the selected text if any, otherwise the statement under the cursor.
  const runActiveStatement = useCallback(() => runSql(resolveActiveStatement()), [runSql, resolveActiveStatement]);

  // Explain / Explain Analyze the active statement (Phase 26). Analyze runs the statement, so it is
  // confirm-gated for anything that isn't obviously a read (SELECT/WITH); the server also rejects it
  // on read-only connections.
  const runExplain = useCallback(
    async (analyze: boolean) => {
      const statement = resolveActiveStatement().trim();
      if (!connectionId || !statement || explainQuery.isPending) return;
      if (analyze && !/^\s*(select|with)\b/i.test(statement)) {
        const confirmed = await confirm({
          title: 'Run statement to analyze?',
          description: 'EXPLAIN ANALYZE executes this statement to measure real timings — this can modify data.',
          confirmLabel: 'Run',
          danger: true,
        });
        if (!confirmed) return;
      }
      explainQuery.mutate(
        { sql: statement, analyze },
        {
          onSuccess: (plan) => {
            setPlanResult(plan);
            setPlanSql(statement);
            resetSuggestions();
          },
          onError: (error) => pushToast('danger', apiErrorDetail(error, 'Failed to explain the statement.')),
        },
      );
    },
    [connectionId, explainQuery, resolveActiveStatement, confirm, pushToast, resetSuggestions],
  );

  // Cmd/Ctrl+Shift+Enter: run the whole tab.
  const runAll = useCallback(() => {
    const text = editorRef.current?.getModel()?.getValue() ?? sql;
    runSql(text);
  }, [runSql, sql]);

  // Editor key handlers route through refs to always call the latest closures
  // (current `sql`/`connectionId`/`transactional`).
  const runActiveStatementRef = useRef(runActiveStatement);
  runActiveStatementRef.current = runActiveStatement;
  const runAllRef = useRef(runAll);
  runAllRef.current = runAll;

  // Remappable editor shortcuts: re-bound whenever the keybinding map changes (a global keydown
  // command can't be removed, so we match chords in `onKeyDown` and dispose on cleanup).
  const keybindings = useThemeStore((state) => state.keybindings);
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !monacoInstance) return;
    const runStatementChord = resolveBinding('run-statement', keybindings);
    const runAllChord = resolveBinding('run-all', keybindings);
    const formatChord = resolveBinding('format-sql', keybindings);
    const disposable = editor.onKeyDown((e) => {
      if (matchesChord(e.browserEvent, runStatementChord)) {
        e.preventDefault();
        e.stopPropagation();
        runActiveStatementRef.current();
      } else if (matchesChord(e.browserEvent, runAllChord)) {
        e.preventDefault();
        e.stopPropagation();
        runAllRef.current();
      } else if (matchesChord(e.browserEvent, formatChord)) {
        e.preventDefault();
        e.stopPropagation();
        void editor.getAction('editor.action.formatDocument')?.run();
      }
    });
    return () => disposable.dispose();
  }, [monacoInstance, keybindings]);

  const onGridReady = useCallback((event: GridReadyEvent) => {
    gridApiRef.current = event.api;
  }, []);

  const onSelectionChanged = useCallback((event: SelectionChangedEvent) => {
    setSelectedRows(event.api.getSelectedRows() as Record<string, unknown>[]);
  }, []);

  const onCellValueChanged = useCallback(
    (event: CellValueChangedEvent) => {
      const column = event.column.getColId();

      if (event.node.rowPinned === 'top') {
        setPendingInsert((prev) => ({ ...prev, [column]: event.newValue }));
        return;
      }

      if (primaryKey.length === 0 || event.newValue === event.oldValue) return;

      const primaryKeyValues: Record<string, unknown> = {};
      for (const pkColumn of primaryKey) primaryKeyValues[pkColumn] = event.data[pkColumn];

      updateCell.mutate(
        { primaryKey: primaryKeyValues, column, value: event.newValue },
        {
          onSuccess: (row) => event.node.setData(row),
          onError: (error) => {
            event.node.setData({ ...event.data, [column]: event.oldValue });
            pushToast('danger', apiErrorDetail(error, `Failed to update "${column}".`));
          },
        },
      );
    },
    [primaryKey, updateCell, pushToast],
  );

  function handleAddRow() {
    setPendingInsert({});
  }

  function handleCancelInsert() {
    setPendingInsert(null);
  }

  function handleSaveInsert() {
    if (!pendingInsert) return;
    const values = Object.fromEntries(
      Object.entries(pendingInsert).filter(([, value]) => value !== '' && value !== undefined),
    );
    insertRow.mutate(
      { values },
      {
        onSuccess: () => {
          setPendingInsert(null);
          gridApiRef.current?.refreshInfiniteCache();
        },
        onError: (error) => pushToast('danger', apiErrorDetail(error, 'Failed to insert row.')),
      },
    );
  }

  async function handleDeleteSelected() {
    if (selectedRows.length === 0) return;
    const noun = selectedRows.length === 1 ? 'this row' : `these ${selectedRows.length} rows`;
    const confirmed = await confirm({
      title: 'Delete rows',
      description: `Delete ${noun}? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!confirmed) return;

    Promise.allSettled(
      selectedRows.map((row) => {
        const primaryKeyValues: Record<string, unknown> = {};
        for (const pkColumn of primaryKey) primaryKeyValues[pkColumn] = row[pkColumn];
        return deleteRow.mutateAsync({ primaryKey: primaryKeyValues });
      }),
    ).then((results) => {
      const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (failed.length > 0) {
        const message =
          failed.length === 1
            ? apiErrorDetail(failed[0]!.reason, 'Failed to delete row.')
            : `Failed to delete ${failed.length} of ${selectedRows.length} rows.`;
        pushToast('danger', message);
      }
      setSelectedRows([]);
      gridApiRef.current?.deselectAll();
      gridApiRef.current?.refreshInfiniteCache();
    });
  }

  function handleSaveSnippet() {
    if (saveSnippetName === null) return;
    const name = saveSnippetName.trim();
    if (!name) return;
    createSnippet.mutate(
      { name, body: sql.trim() },
      {
        onSuccess: () => setSaveSnippetName(null),
        onError: (err) => pushToast('danger', apiErrorMessage(err, 'Failed to save snippet.')),
      },
    );
  }

  const error = executeQuery.error;
  const errorCode = error instanceof ApiError ? error.code : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="h-1/2 min-h-0 border-b border-border max-md:h-2/5">
        <Editor
          height="100%"
          defaultLanguage="sql"
          value={sql}
          onChange={(value) => setTabSql(activeTabId, value ?? '')}
          theme={monacoThemeName}
          beforeMount={defineProstMonacoThemes}
          onMount={(editor, monaco) => {
            editorRef.current = editor;
            setMonacoInstance(monaco);
            // Run/format shortcuts are bound in a keybindings-aware effect (see above) so they
            // stay remappable; the formatting provider below supplies the actual format edits.
            monaco.languages.registerDocumentFormattingEditProvider('sql', {
              provideDocumentFormattingEdits(model) {
                const formatted = format(model.getValue(), {
                  language: formatterDialectRef.current,
                  tabWidth: 2,
                  keywordCase: 'upper',
                });
                return [{ range: model.getFullModelRange(), text: formatted }];
              },
            });
            const position = editor.getPosition();
            if (position) setCursorPosition({ line: position.lineNumber, column: position.column });
            editor.onDidChangeCursorPosition((event) => {
              setCursorPosition({ line: event.position.lineNumber, column: event.position.column });
            });
          }}
          options={{
            fontSize: EDITOR_FONT_PX[editorPrefs.fontSize ?? 'md'],
            fontFamily: monoFontFamily ? MONO_FONT_FAMILY_STACK[monoFontFamily] : 'JetBrains Mono, monospace',
            tabSize: editorPrefs.tabSize ?? 2,
            insertSpaces: editorPrefs.insertSpaces ?? true,
            wordWrap: editorPrefs.wordWrap ? 'on' : 'off',
            lineNumbers: editorPrefs.lineNumbers ?? 'on',
            minimap: { enabled: editorPrefs.minimap ?? false },
            padding: { top: 8 },
          }}
        />
      </div>
      <div className="flex h-1/2 min-h-0 flex-col overflow-hidden max-md:h-3/5">
        <div className="flex h-8 max-md:h-11 shrink-0 items-center gap-sm overflow-x-auto border-b border-border bg-surface px-sm [&>*]:shrink-0">
          <Button
            variant="primary"
            size="sm"
            onClick={runActiveStatement}
            disabled={!connectionId || !sql.trim() || executeQuery.isPending}
            className="shrink-0"
            title="Run the selected text, or the statement under the cursor (Cmd/Ctrl+Enter). Cmd/Ctrl+Shift+Enter runs all."
          >
            <Play size={12} />
            {executeQuery.isPending ? 'Running…' : 'Run'}
          </Button>
          {descriptor?.supportsQueryPlan ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void runExplain(false)}
              disabled={!connectionId || !sql.trim() || explainQuery.isPending}
              className="shrink-0"
              title="Show the estimated query plan for the statement under the cursor"
            >
              Explain
            </Button>
          ) : null}
          {descriptor?.supportsExplainAnalyze ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void runExplain(true)}
              disabled={!connectionId || !sql.trim() || explainQuery.isPending}
              className="shrink-0"
              title="Run the statement and show the plan with actual timings (executes the statement)"
            >
              Analyze
            </Button>
          ) : null}
          <label
            className="flex shrink-0 items-center gap-xs text-xs text-text-faint"
            title="Wrap the script in BEGIN/COMMIT and roll back on any error. Don't combine with your own BEGIN/COMMIT."
          >
            <Switch
              checked={transactional}
              // Per-tab override only. The global default comes from Settings › Behavior
              // ("Run in a transaction by default"); toggling one tab must not silently rewrite it.
              onChange={(e) => setTabTransactional(activeTabId, e.target.checked)}
              aria-label="Run as transaction"
            />
            Transaction
          </label>
          {saveSnippetName === null ? (
            <IconButton aria-label="Save snippet" onClick={() => setSaveSnippetName('')}>
              <Bookmark size={14} />
            </IconButton>
          ) : (
            <>
              <Input
                value={saveSnippetName}
                onChange={(e) => setSaveSnippetName(e.target.value)}
                placeholder="Snippet name"
                className="h-6 w-40 text-xs"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveSnippet();
                  if (e.key === 'Escape') setSaveSnippetName(null);
                }}
                autoFocus
              />
              <Button
                size="sm"
                onClick={handleSaveSnippet}
                disabled={!saveSnippetName.trim() || createSnippet.isPending}
              >
                Save
              </Button>
              <IconButton aria-label="Cancel save" onClick={() => setSaveSnippetName(null)}>
                <X size={14} />
              </IconButton>
            </>
          )}
          <IconButton
            aria-label="Format SQL"
            title="Format SQL (Shift+Alt+F)"
            onClick={() => editorRef.current?.getAction('editor.action.formatDocument')?.run()}
          >
            <WandSparkles size={14} />
          </IconButton>
          <span className="hidden text-xs text-text-faint sm:inline">⌘/Ctrl + Enter</span>
          {isGridResult && !planResult ? (
            <>
              <div className="mx-1 h-4 w-px bg-border" />
              <IconButton aria-label="Add row" onClick={handleAddRow} disabled={!editable || pendingInsert !== null}>
                <Plus size={14} />
              </IconButton>
              <IconButton
                aria-label="Delete selected rows"
                onClick={handleDeleteSelected}
                disabled={!editable || selectedRows.length === 0}
              >
                <Trash2 size={14} />
              </IconButton>
              <IconButton
                aria-label="Save new row"
                onClick={handleSaveInsert}
                disabled={pendingInsert === null || insertRow.isPending}
              >
                <Save size={14} />
              </IconButton>
              {pendingInsert !== null ? (
                <IconButton aria-label="Cancel new row" onClick={handleCancelInsert}>
                  <X size={14} />
                </IconButton>
              ) : null}
            </>
          ) : null}
          <div className="ml-auto flex shrink-0 items-center gap-sm whitespace-nowrap text-xs text-text-faint">
            {!planResult && single?.kind === 'rows' ? (
              <>
                <Badge variant={editable ? 'success' : 'neutral'}>{editable ? 'Editable' : 'Read-only'}</Badge>
                {streamTruncatedAt !== null ? (
                  <Badge variant="warning">truncated at {streamTruncatedAt.toLocaleString()}</Badge>
                ) : null}
                {streamReaped ? <Badge variant="neutral">paged</Badge> : null}
                <span>
                  {single.truncated
                    ? `${single.rows.length}+ rows`
                    : `${single.rows.length} row${single.rows.length === 1 ? '' : 's'}`}{' '}
                  · {single.executionTimeMs} ms
                </span>
                <div className="flex overflow-hidden rounded-sm border border-border">
                  <Button
                    type="button"
                    variant={resultView === 'grid' ? 'secondary' : 'ghost'}
                    size="sm"
                    onClick={() => setResultView('grid')}
                    className="rounded-none border-0"
                  >
                    Grid
                  </Button>
                  <div className="w-px bg-border" />
                  <Button
                    type="button"
                    variant={resultView === 'chart' ? 'secondary' : 'ghost'}
                    size="sm"
                    onClick={() => setResultView('chart')}
                    className="rounded-none border-0"
                  >
                    Chart
                  </Button>
                </div>
                <IconButton aria-label="Export results" title="Export query result" onClick={() => setExportOpen(true)}>
                  <Download size={14} />
                </IconButton>
              </>
            ) : null}
            {!planResult && single?.kind === 'command' ? (
              <span>
                {single.command} · {single.rowCount} row{single.rowCount === 1 ? '' : 's'} affected · {single.executionTimeMs} ms
              </span>
            ) : null}
            {!planResult && single?.kind === 'plan' ? (
              <>
                {single.analyze ? <Badge variant="warning">Analyze</Badge> : null}
                <span>{single.executionTimeMs} ms</span>
              </>
            ) : null}
            {!planResult && single?.kind === 'error' ? <Badge variant="danger">{single.code ?? 'SQL_ERROR'}</Badge> : null}
          </div>
        </div>
        <div className="min-h-0 flex-1">
          {planResult ? (
            <QueryPlanView
              plan={planResult}
              className="h-full"
              // Suggestions are DDL writes, so the entry point is hidden on read-only connections
              // (the server refuses it there too).
              {...(writable
                ? {
                    onSuggestIndexes: () => suggest.request({ plan: planResult, sql: planSql }),
                    suggesting: suggest.isPending,
                  }
                : {})}
              {...(suggest.suggestions !== null || suggest.isPending
                ? {
                    footer: (
                      <SchemaSuggestionList
                        connectionId={connectionId ?? ''}
                        suggestions={suggest.suggestions ?? []}
                        loading={suggest.isPending}
                        error={suggest.error}
                      />
                    ),
                  }
                : {})}
            />
          ) : error ? (
            <div className="flex h-full flex-col items-center justify-center gap-xs p-md text-center">
              <Badge variant="danger">{errorCode ?? 'ERROR'}</Badge>
              <p className="max-w-[28rem] text-sm text-text">{apiErrorMessage(error, 'Query failed.')}</p>
              {error instanceof ApiError && error.correlationId ? (
                <p className="text-xs text-text-faint">ref: {error.correlationId}</p>
              ) : null}
              <FixWithAiButton
                sql={sql}
                message={apiErrorMessage(error, 'Query failed.')}
                {...(errorCode ? { code: errorCode } : {})}
                engineLabel={descriptor?.label}
                className="mt-sm"
              />
            </div>
          ) : !connectionId ? (
            <div className="flex h-full items-center justify-center text-sm text-text-faint">
              Select a connection to run queries.
            </div>
          ) : response === null ? (
            <div className="flex h-full items-center justify-center text-sm text-text-faint">
              Run a query to see results here.
            </div>
          ) : single ? (
            single.kind === 'rows' ? (
              resultView === 'chart' && connectionId ? (
                <ResultChartPanel connectionId={connectionId} columns={single.columns} rows={single.rows} />
              ) : (
                <AgGridReact
                  key={`${activeTabId}.${resultEpoch}`}
                  theme={prostGridTheme}
                  rowHeight={gridRowHeight}
                  headerHeight={gridRowHeight}
                  columnDefs={columnDefs}
                  rowModelType="infinite"
                  datasource={datasource}
                  cacheBlockSize={pageSize}
                  maxBlocksInCache={10}
                  maxConcurrentDatasourceRequests={1}
                  getRowId={getRowId}
                  pinnedTopRowData={pinnedTopRowData}
                  rowSelection={editable ? { mode: 'multiRow', checkboxes: true, headerCheckbox: false } : undefined}
                  onGridReady={onGridReady}
                  onSelectionChanged={onSelectionChanged}
                  onCellValueChanged={onCellValueChanged}
                  onCellClicked={onCellClicked}
                />
              )
            ) : single.kind === 'command' ? (
              <div className="flex h-full items-center justify-center text-sm text-text-faint">
                {single.command} — {single.rowCount} row{single.rowCount === 1 ? '' : 's'} affected.
              </div>
            ) : single.kind === 'plan' ? (
              <PlanPanel planText={single.planText} analyze={single.analyze} className="h-full" />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-xs p-md text-center">
                <Badge variant="danger">{single.code ?? 'SQL_ERROR'}</Badge>
                <p className="max-w-[28rem] text-sm text-text">{single.message}</p>
                <p className="text-xs text-text-faint">ref: {single.correlationId}</p>
                <FixWithAiButton
                  sql={single.sql}
                  message={single.message}
                  code={single.code}
                  engineLabel={descriptor?.label}
                  className="mt-sm"
                />
              </div>
            )
          ) : statements.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-text-faint">
              No statements to run.
            </div>
          ) : (
            <div className="flex h-full flex-col gap-sm overflow-y-auto p-sm">
              {statements.map((statement, i) => (
                <StatementResultPanel key={i} index={i} total={statements.length} statement={statement} />
              ))}
              {response.transactional && statements.length < response.statementCount ? (
                <Badge variant="warning">
                  Transaction rolled back — {statements.length} of {response.statementCount} statement(s) ran
                </Badge>
              ) : null}
            </div>
          )}
        </div>
      </div>
      <ColumnRenderMenu
        state={renderMenu}
        currentMode={renderMenu ? renderOverrides?.[renderMenu.field] : undefined}
        onSelect={handleSelectRenderMode}
        onClose={() => setRenderMenu(null)}
      />
      <JsonCellPopup cell={jsonCell} onClose={() => setJsonCell(null)} />
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-sm p-md sm:items-end">
        {toasts.map((toast) => (
          <div key={toast.id} className="pointer-events-auto w-full max-w-[24rem]">
            <Toast variant={toast.variant} message={toast.message} onDismiss={() => dismissToast(toast.id)} />
          </div>
        ))}
      </div>
      {confirmDialog}
      {connectionId && editableResult ? (
        <ExportDialog
          open={exportOpen}
          onClose={() => setExportOpen(false)}
          connectionId={connectionId}
          target={{ scope: 'query', sql: editableResult.sql }}
        />
      ) : null}
    </div>
  );
}
