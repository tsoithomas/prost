import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import Editor, { type Monaco, type OnMount } from '@monaco-editor/react';
import { AgGridReact } from 'ag-grid-react';
import type {
  CellValueChangedEvent,
  GetRowIdParams,
  GridApi,
  GridReadyEvent,
  SelectionChangedEvent,
} from 'ag-grid-community';
import { Bookmark, Play, Plus, Save, Trash2, WandSparkles, X } from 'lucide-react';
import { format } from 'sql-formatter';
import type { ExecuteQueryResponse } from '@prost/shared-types';
import {
  Badge,
  Button,
  Checkbox,
  IconButton,
  Input,
  PROST_DARK_THEME,
  PROST_LIGHT_THEME,
  Toast,
  defineProstMonacoThemes,
  prostGridTheme,
  resolveColorMode,
} from '@prost/ui';
import { useDeleteRow, useInsertRow, useUpdateCell } from '../api/grid';
import { useMetadata } from '../api/metadata';
import { useExecuteQuery } from '../api/query';
import { useCreateSnippet } from '../api/snippets';
import { buildColumnDefs } from '../grid/columnDefs';
import { useConfirm } from '../hooks/useConfirm';
import { useToasts } from '../hooks/useToasts';
import { ApiError, apiErrorDetail, apiErrorMessage } from '../lib/apiClient';
import { useConnectionStore } from '../stores/connectionStore';
import { useThemeStore } from '../stores/themeStore';
import { INITIAL_SQL, useWorkspaceStore } from '../stores/workspaceStore';
import { PlanPanel, StatementResultPanel } from './StatementResultPanel';
import { useMonacoCompletions } from './useMonacoCompletions';

/** `sourceTable` is `schema.table` (see `editability.ts`) — split it back for the Phase 2 mutation hooks. */
function splitSourceTable(sourceTable: string | undefined): { schema: string; table: string } | null {
  if (!sourceTable) return null;
  const dot = sourceTable.indexOf('.');
  if (dot === -1) return null;
  return { schema: sourceTable.slice(0, dot), table: sourceTable.slice(dot + 1) };
}

export function SqlEditorView() {
  const connectionId = useConnectionStore((state) => state.activeConnectionId);
  const colorMode = useThemeStore((state) => state.colorMode);
  const accentColor = useThemeStore((state) => state.accentColor);
  const pendingQuerySql = useWorkspaceStore((state) => state.pendingQuerySql);
  const clearPendingQuerySql = useWorkspaceStore((state) => state.clearPendingQuerySql);
  const setCursorPosition = useWorkspaceStore((state) => state.setCursorPosition);
  const activeTabId = useWorkspaceStore((state) => state.activeTabId);
  const activeTab = useWorkspaceStore((state) => state.tabs.find((tab) => tab.id === state.activeTabId));
  const setTabSql = useWorkspaceStore((state) => state.setTabSql);
  const setTabResult = useWorkspaceStore((state) => state.setTabResult);
  const setTabTransactional = useWorkspaceStore((state) => state.setTabTransactional);
  const queryClient = useQueryClient();
  const monacoTheme = resolveColorMode(colorMode) === 'dark' ? PROST_DARK_THEME : PROST_LIGHT_THEME;
  const monacoRef = useRef<Monaco | null>(null);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const gridApiRef = useRef<GridApi | null>(null);
  const [monacoInstance, setMonacoInstance] = useState<Monaco | null>(null);

  const sql = activeTab?.sql ?? INITIAL_SQL;
  const transactional = activeTab?.transactional ?? false;
  const [saveSnippetName, setSaveSnippetName] = useState<string | null>(null);
  const [response, setResponse] = useState<ExecuteQueryResponse | null>(activeTab?.result ?? null);
  const initialStatements = activeTab?.result?.statements ?? [];
  const initialSingle = initialStatements.length === 1 ? initialStatements[0] : null;
  const [rowData, setRowData] = useState<Record<string, unknown>[]>(initialSingle?.kind === 'rows' ? initialSingle.rows : []);
  const [pendingInsert, setPendingInsert] = useState<Record<string, unknown> | null>(null);
  const [selectedRows, setSelectedRows] = useState<Record<string, unknown>[]>([]);
  const { toasts, push: pushToast, dismiss: dismissToast } = useToasts();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const createSnippet = useCreateSnippet();

  const executeQuery = useExecuteQuery(connectionId ?? '');
  const { data: schemaMetadata } = useMetadata(connectionId);
  useMonacoCompletions(monacoInstance, schemaMetadata);

  const statements = response?.statements ?? [];
  const single = statements.length === 1 ? statements[0]! : null;
  const editableResult = single?.kind === 'rows' ? single : null;

  const sourceTable = editableResult ? splitSourceTable(editableResult.sourceTable) : null;
  const updateCell = useUpdateCell(connectionId ?? '', sourceTable?.schema ?? '', sourceTable?.table ?? '');
  const insertRow = useInsertRow(connectionId ?? '', sourceTable?.schema ?? '', sourceTable?.table ?? '');
  const deleteRow = useDeleteRow(connectionId ?? '', sourceTable?.schema ?? '', sourceTable?.table ?? '');

  const editable = editableResult?.editable ?? false;
  const primaryKey = editableResult?.primaryKey ?? [];
  const isGridResult = editableResult !== null;

  const columnDefs = useMemo(
    () => (editableResult ? buildColumnDefs(editableResult.columns, editable) : []),
    [editableResult, editable],
  );

  const getRowId = useMemo(() => {
    if (primaryKey.length === 0) return undefined;
    return (params: GetRowIdParams) => primaryKey.map((column) => String(params.data[column])).join('::');
  }, [primaryKey]);

  const pinnedTopRowData = useMemo(() => (pendingInsert ? [pendingInsert] : undefined), [pendingInsert]);

  // `defineProstMonacoThemes` snapshots the current CSS variable values, so it must be
  // re-run whenever the color mode or accent color changes to keep Monaco in sync.
  useEffect(() => {
    if (!monacoRef.current) return;
    defineProstMonacoThemes(monacoRef.current);
    monacoRef.current.editor.setTheme(monacoTheme);
  }, [colorMode, accentColor, monacoTheme]);

  // Switching tabs swaps the editor buffer + results to that tab's stored state and
  // clears any in-progress edit/selection UI from the previous tab.
  useEffect(() => {
    const storedSql = activeTab?.sql ?? INITIAL_SQL;
    const storedResponse = activeTab?.result ?? null;
    editorRef.current?.setValue(storedSql);
    setResponse(storedResponse);
    const storedStatements = storedResponse?.statements ?? [];
    const storedSingle = storedStatements.length === 1 ? storedStatements[0]! : null;
    setRowData(storedSingle?.kind === 'rows' ? storedSingle.rows : []);
    setPendingInsert(null);
    setSelectedRows([]);
    setSaveSnippetName(null);
  }, [activeTabId]);

  // Loading a query from history sets `pendingQuerySql` (see `workspaceStore.loadQuery`);
  // consume it into the editor buffer and clear it so it doesn't reapply on remount.
  useEffect(() => {
    if (pendingQuerySql === null) return;
    editorRef.current?.setValue(pendingQuerySql);
    setTabSql(activeTabId, pendingQuerySql);
    clearPendingQuerySql();
  }, [pendingQuerySql, clearPendingQuerySql, activeTabId, setTabSql]);

  const runQuery = useCallback(() => {
    const trimmed = sql.trim();
    if (!connectionId || !trimmed || executeQuery.isPending) return;

    setPendingInsert(null);
    setSelectedRows([]);
    gridApiRef.current?.deselectAll();

    executeQuery.mutate(
      { sql: trimmed, transactional },
      {
        onSuccess: (data) => {
          setResponse(data);
          const resultStatements = data.statements;
          const resultSingle = resultStatements.length === 1 ? resultStatements[0]! : null;
          setRowData(resultSingle?.kind === 'rows' ? resultSingle.rows : []);
          setTabResult(activeTabId, data);
          queryClient.invalidateQueries({ queryKey: ['history', connectionId] });
        },
      },
    );
  }, [connectionId, executeQuery, sql, transactional, queryClient, activeTabId, setTabResult]);

  // Monaco's Cmd/Ctrl+Enter command is registered once in `onMount`, so route it through a
  // ref to always call the latest `runQuery` (current `sql`/`connectionId`).
  const runQueryRef = useRef(runQuery);
  runQueryRef.current = runQuery;

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
        onSuccess: (row) => {
          setPendingInsert(null);
          setRowData((prev) => [row, ...prev]);
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
        return deleteRow.mutateAsync({ primaryKey: primaryKeyValues }).then(() => row);
      }),
    ).then((results) => {
      const deleted = new Set<Record<string, unknown>>();
      const failed: PromiseRejectedResult[] = [];
      for (const settled of results) {
        if (settled.status === 'fulfilled') deleted.add(settled.value);
        else failed.push(settled);
      }
      if (failed.length > 0) {
        const message =
          failed.length === 1
            ? apiErrorDetail(failed[0]!.reason, 'Failed to delete row.')
            : `Failed to delete ${failed.length} of ${selectedRows.length} rows.`;
        pushToast('danger', message);
      }
      setRowData((prev) => prev.filter((row) => !deleted.has(row)));
      setSelectedRows([]);
      gridApiRef.current?.deselectAll();
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
          theme={monacoTheme}
          beforeMount={defineProstMonacoThemes}
          onMount={(editor, monaco) => {
            editorRef.current = editor;
            monacoRef.current = monaco;
            setMonacoInstance(monaco);
            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => runQueryRef.current());
            monaco.languages.registerDocumentFormattingEditProvider('sql', {
              provideDocumentFormattingEdits(model) {
                const formatted = format(model.getValue(), { language: 'postgresql', tabWidth: 2, keywordCase: 'upper' });
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
            fontSize: 13,
            fontFamily: 'JetBrains Mono, monospace',
            minimap: { enabled: false },
            padding: { top: 8 },
          }}
        />
      </div>
      <div className="flex h-1/2 min-h-0 flex-col overflow-hidden max-md:h-3/5">
        <div className="flex h-8 max-md:h-11 shrink-0 items-center gap-sm overflow-x-auto border-b border-border bg-surface px-sm">
          <Button
            variant="primary"
            size="sm"
            onClick={runQuery}
            disabled={!connectionId || !sql.trim() || executeQuery.isPending}
            className="shrink-0"
          >
            <Play size={12} />
            {executeQuery.isPending ? 'Running…' : 'Run'}
          </Button>
          <label
            className="flex shrink-0 items-center gap-xs text-xs text-text-faint"
            title="Wrap the script in BEGIN/COMMIT and roll back on any error. Don't combine with your own BEGIN/COMMIT."
          >
            <Checkbox
              checked={transactional}
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
          {isGridResult ? (
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
            {single?.kind === 'rows' ? (
              <>
                <Badge variant={editable ? 'success' : 'neutral'}>{editable ? 'Editable' : 'Read-only'}</Badge>
                {single.truncated ? <Badge variant="warning">Truncated</Badge> : null}
                <span>
                  {rowData.length} row{rowData.length === 1 ? '' : 's'} · {single.executionTimeMs} ms
                </span>
              </>
            ) : null}
            {single?.kind === 'command' ? (
              <span>
                {single.command} · {single.rowCount} row{single.rowCount === 1 ? '' : 's'} affected · {single.executionTimeMs} ms
              </span>
            ) : null}
            {single?.kind === 'plan' ? (
              <>
                {single.analyze ? <Badge variant="warning">Analyze</Badge> : null}
                <span>{single.executionTimeMs} ms</span>
              </>
            ) : null}
            {single?.kind === 'error' ? <Badge variant="danger">{single.code ?? 'SQL_ERROR'}</Badge> : null}
          </div>
        </div>
        <div className="min-h-0 flex-1">
          {error ? (
            <div className="flex h-full flex-col items-center justify-center gap-xs p-md text-center">
              <Badge variant="danger">{errorCode ?? 'ERROR'}</Badge>
              <p className="max-w-[28rem] text-sm text-text">{apiErrorMessage(error, 'Query failed.')}</p>
              {error instanceof ApiError && error.correlationId ? (
                <p className="text-xs text-text-faint">ref: {error.correlationId}</p>
              ) : null}
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
              <AgGridReact
                theme={prostGridTheme}
                columnDefs={columnDefs}
                rowData={rowData}
                getRowId={getRowId}
                pinnedTopRowData={pinnedTopRowData}
                rowSelection={editable ? { mode: 'multiRow', checkboxes: true, headerCheckbox: false } : undefined}
                onGridReady={onGridReady}
                onSelectionChanged={onSelectionChanged}
                onCellValueChanged={onCellValueChanged}
              />
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
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-sm p-md sm:items-end">
        {toasts.map((toast) => (
          <div key={toast.id} className="pointer-events-auto w-full max-w-[24rem]">
            <Toast variant={toast.variant} message={toast.message} onDismiss={() => dismissToast(toast.id)} />
          </div>
        ))}
      </div>
      {confirmDialog}
    </div>
  );
}
