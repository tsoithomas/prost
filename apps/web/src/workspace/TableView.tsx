import { useCallback, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AgGridReact } from 'ag-grid-react';
import type {
  CellValueChangedEvent,
  GetRowIdParams,
  GridApi,
  GridReadyEvent,
  IDatasource,
  IGetRowsParams,
  SelectionChangedEvent,
} from 'ag-grid-community';
import { CopyPlus, Filter, Plus, Redo2, Save, Trash2, Undo2, X } from 'lucide-react';
import type { BulkRowEdit, GridResponse, RowConcurrency, RowFilter } from '@prost/shared-types';
import { ROW_VERSION_KEY } from '@prost/shared-types';
import { Badge, Button, IconButton, prostGridTheme, Toast } from '@prost/ui';
import { FilterPanel } from './FilterPanel';
import { TableStructurePanel } from './TableStructurePanel';
import { useActiveConnection } from '../api/connections';
import { useBulkUpdate, useDeleteRow, useInsertRow } from '../api/grid';
import { buildColumnDefs } from '../grid/columnDefs';
import { useEditBuffer } from '../grid/useEditBuffer';
import { useConfirm } from '../hooks/useConfirm';
import { useToasts } from '../hooks/useToasts';
import { ApiError, apiErrorDetail, apiFetch } from '../lib/apiClient';

/** A committed batch we can reverse: each row's pre-edit (`before`) and edited (`after`) values, plus its live version. */
interface UndoRow {
  rowKey: string;
  primaryKey: Record<string, unknown>;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  version?: string;
}

export interface TableViewProps {
  connectionId: string;
  schema: string;
  table: string;
  viewMode: 'rows' | 'structure';
  onViewModeChange: (mode: 'rows' | 'structure') => void;
}

const PAGE_SIZE = 100;

function rowsUrl(connectionId: string, schema: string, table: string, search: URLSearchParams): string {
  return `/connections/${connectionId}/tables/${encodeURIComponent(schema)}/${encodeURIComponent(table)}/rows?${search}`;
}

export function TableView({ connectionId, schema, table, viewMode, onViewModeChange }: TableViewProps) {
  const gridApiRef = useRef<GridApi | null>(null);
  const [pendingInsert, setPendingInsert] = useState<Record<string, unknown> | null>(null);
  const [selectedRows, setSelectedRows] = useState<Record<string, unknown>[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [activeFilter, setActiveFilter] = useState<RowFilter | null>(null);
  const [lastEdit, setLastEdit] = useState<{ column: string; value: unknown } | null>(null);
  const [undoStack, setUndoStack] = useState<UndoRow[][]>([]);
  const [redoStack, setRedoStack] = useState<UndoRow[][]>([]);
  const { toasts, push: pushToast, dismiss: dismissToast } = useToasts();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const editBuffer = useEditBuffer();

  const filterKey = activeFilter?.conditions.length ? JSON.stringify(activeFilter) : null;

  // Stable query — no filter in key. Columns/editable/primaryKey never change with filtering.
  const columnsQuery = useQuery({
    queryKey: ['grid-columns', connectionId, schema, table],
    queryFn: () =>
      apiFetch<GridResponse>(rowsUrl(connectionId, schema, table, new URLSearchParams({ limit: '1', offset: '0' }))),
  });

  // Separate count query that re-runs when the filter changes.
  const countQuery = useQuery({
    queryKey: ['grid-count', connectionId, schema, table, filterKey],
    queryFn: () => {
      const search = new URLSearchParams({ limit: '1', offset: '0' });
      if (filterKey) search.set('filter', filterKey);
      return apiFetch<GridResponse>(rowsUrl(connectionId, schema, table, search));
    },
    placeholderData: (prev) => prev,
  });

  // Read-only connections (the app DB) never allow grid writes, regardless of table editability.
  const activeConnection = useActiveConnection();
  const writable = !activeConnection?.capabilities.readOnly;
  const editable = (columnsQuery.data?.editable ?? false) && writable;
  const primaryKey = columnsQuery.data?.primaryKey ?? [];
  const concurrency: RowConcurrency = columnsQuery.data?.concurrency ?? 'preimage';

  const insertRow = useInsertRow(connectionId, schema, table);
  const deleteRow = useDeleteRow(connectionId, schema, table);
  const bulkUpdate = useBulkUpdate(connectionId, schema, table);

  const rowKeyOf = useCallback(
    (row: Record<string, unknown>) => primaryKey.map((c) => String(row[c])).join('::'),
    [primaryKey],
  );
  const identityOf = useCallback(
    (row: Record<string, unknown>) => ({
      primaryKey: Object.fromEntries(primaryKey.map((c) => [c, row[c]])),
      version: row[ROW_VERSION_KEY] as string | undefined,
    }),
    [primaryKey],
  );

  const columnDefs = useMemo(
    () => (columnsQuery.data ? buildColumnDefs(columnsQuery.data.columns, editable) : []),
    [columnsQuery.data, editable],
  );

  const getRowId = useMemo(() => {
    if (primaryKey.length === 0) return undefined;
    return (params: GetRowIdParams) => primaryKey.map((column) => String(params.data[column])).join('::');
  }, [primaryKey]);

  const pinnedTopRowData = useMemo(() => (pendingInsert ? [pendingInsert] : undefined), [pendingInsert]);

  const datasource = useMemo<IDatasource>(
    () => ({
      getRows: (params: IGetRowsParams) => {
        const limit = params.endRow - params.startRow;
        const offset = params.startRow;
        const search = new URLSearchParams({ limit: String(limit), offset: String(offset) });
        const sort = params.sortModel[0];
        if (sort) {
          search.set('sortBy', sort.colId);
          search.set('sortDir', sort.sort);
        }
        if (activeFilter?.conditions.length) {
          search.set('filter', JSON.stringify(activeFilter));
        }
        apiFetch<GridResponse>(rowsUrl(connectionId, schema, table, search))
          .then((response) => {
            const lastRow = response.rows.length < limit ? offset + response.rows.length : undefined;
            params.successCallback(response.rows, lastRow);
          })
          .catch(() => params.failCallback());
      },
    }),
    [connectionId, schema, table, activeFilter],
  );

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

      if (primaryKey.length === 0) return;

      const data = event.data as Record<string, unknown>;
      editBuffer.stage(rowKeyOf(data), identityOf(data), column, event.oldValue, event.newValue);
      setLastEdit({ column, value: event.newValue });
    },
    [primaryKey, editBuffer, rowKeyOf, identityOf],
  );

  /** Fan the most recent edit's value into the same column across every selected row (all staged). */
  const handleApplyToSelected = useCallback(() => {
    if (!lastEdit) return;
    for (const row of selectedRows) {
      editBuffer.stage(rowKeyOf(row), identityOf(row), lastEdit.column, row[lastEdit.column], lastEdit.value);
      gridApiRef.current?.getRowNode(rowKeyOf(row))?.setDataValue(lastEdit.column, lastEdit.value);
    }
  }, [lastEdit, selectedRows, editBuffer, rowKeyOf, identityOf]);

  /** Pushes the returned rows back into the grid and returns their refreshed version tokens by rowKey. */
  const applyResultRows = useCallback(
    (rows: Record<string, unknown>[]) => {
      const versions: Record<string, string | undefined> = {};
      for (const row of rows) {
        const key = rowKeyOf(row);
        versions[key] = row[ROW_VERSION_KEY] as string | undefined;
        gridApiRef.current?.getRowNode(key)?.setData(row);
      }
      return versions;
    },
    [rowKeyOf],
  );

  const handleDiscard = useCallback(() => {
    editBuffer.clear();
    setLastEdit(null);
    gridApiRef.current?.refreshInfiniteCache();
  }, [editBuffer]);

  const handleSave = useCallback(() => {
    const entries = Object.entries(editBuffer.buffer);
    if (entries.length === 0) return;
    const body = editBuffer.buildBody(concurrency);

    bulkUpdate.mutate(body, {
      onSuccess: (result) => {
        const versions = applyResultRows(result.rows);
        // Record the committed batch for undo (before = original values, after = edited values).
        const batch: UndoRow[] = entries.map(([rowKey, entry]) => ({
          rowKey,
          primaryKey: entry.primaryKey,
          before: entry.original,
          after: entry.edits,
          version: versions[rowKey],
        }));
        setUndoStack((prev) => [...prev, batch]);
        setRedoStack([]);
        editBuffer.clear();
        setLastEdit(null);
      },
      onError: (error) => {
        const conflict = error instanceof ApiError && error.code === 'CONFLICT';
        pushToast(
          'danger',
          apiErrorDetail(error, conflict ? 'A row changed since you loaded it — nothing was saved.' : 'Failed to save edits.'),
        );
        // Keep the buffer intact on conflict (no silent overwrite); offer a refresh.
        if (conflict) gridApiRef.current?.refreshInfiniteCache();
      },
    });
  }, [editBuffer, concurrency, bulkUpdate, applyResultRows, pushToast]);

  /**
   * Issues a concurrency-checked compensating write to drive each row to `target` (its `before`
   * values for undo, `after` for redo). The guard uses the row's *current* known state, so an undo
   * can itself conflict and is surfaced honestly. Returns the next entries with refreshed versions.
   */
  const runCompensating = useCallback(
    (batch: UndoRow[], direction: 'undo' | 'redo', onDone: (next: UndoRow[]) => void) => {
      const rows: BulkRowEdit[] = batch.map((row) => {
        const target = direction === 'undo' ? row.before : row.after;
        const current = direction === 'undo' ? row.after : row.before;
        const edits = Object.entries(target).map(([column, value]) => ({ column, value }));
        return concurrency === 'token'
          ? { primaryKey: row.primaryKey, edits, version: row.version }
          : { primaryKey: row.primaryKey, edits, expected: current };
      });

      bulkUpdate.mutate(
        { rows },
        {
          onSuccess: (result) => {
            const versions = applyResultRows(result.rows);
            onDone(batch.map((row) => ({ ...row, version: versions[row.rowKey] })));
          },
          onError: (error) => {
            const conflict = error instanceof ApiError && error.code === 'CONFLICT';
            pushToast(
              'danger',
              apiErrorDetail(error, conflict ? 'A row changed since you loaded it — could not undo.' : 'Failed to undo.'),
            );
            if (conflict) gridApiRef.current?.refreshInfiniteCache();
          },
        },
      );
    },
    [concurrency, bulkUpdate, applyResultRows, pushToast],
  );

  const handleUndo = useCallback(() => {
    const batch = undoStack[undoStack.length - 1];
    if (!batch) return;
    runCompensating(batch, 'undo', (next) => {
      setUndoStack((prev) => prev.slice(0, -1));
      setRedoStack((prev) => [...prev, next]);
    });
  }, [undoStack, runCompensating]);

  const handleRedo = useCallback(() => {
    const batch = redoStack[redoStack.length - 1];
    if (!batch) return;
    runCompensating(batch, 'redo', (next) => {
      setRedoStack((prev) => prev.slice(0, -1));
      setUndoStack((prev) => [...prev, next]);
    });
  }, [redoStack, runCompensating]);

  const onGridKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (!editable || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return;
      event.preventDefault();
      if (event.shiftKey) handleRedo();
      else handleUndo();
    },
    [editable, handleRedo, handleUndo],
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
      gridApiRef.current?.deselectAll();
      gridApiRef.current?.refreshInfiniteCache();
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex h-8 max-md:h-11 shrink-0 items-center gap-1 border-b border-border bg-surface px-sm">
        {viewMode === 'rows' ? (
          <>
            <IconButton
              aria-label="Filter rows"
              onClick={() => setFilterOpen((open) => !open)}
              title="Filter rows"
              className="relative"
            >
              <Filter size={14} />
              {(activeFilter?.conditions.length ?? 0) > 0 ? (
                <Badge variant="neutral" className="absolute -right-1 -top-1 h-4 min-w-4 px-0.5 text-[10px] leading-none">
                  {activeFilter!.conditions.length}
                </Badge>
              ) : null}
            </IconButton>
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
            <div className="mx-1 h-4 w-px bg-border" />
            <IconButton
              aria-label="Apply last edit to selected rows"
              title="Apply last edit to selected rows"
              onClick={handleApplyToSelected}
              disabled={!editable || lastEdit === null || selectedRows.length === 0}
            >
              <CopyPlus size={14} />
            </IconButton>
            <IconButton aria-label="Undo" title="Undo (⌘Z)" onClick={handleUndo} disabled={undoStack.length === 0}>
              <Undo2 size={14} />
            </IconButton>
            <IconButton aria-label="Redo" title="Redo (⇧⌘Z)" onClick={handleRedo} disabled={redoStack.length === 0}>
              <Redo2 size={14} />
            </IconButton>
            {editBuffer.dirtyCells > 0 ? (
              <div className="ml-1 flex items-center gap-1">
                <Button type="button" variant="primary" size="sm" onClick={handleSave} disabled={bulkUpdate.isPending}>
                  Save {editBuffer.dirtyCells} {editBuffer.dirtyCells === 1 ? 'edit' : 'edits'}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={handleDiscard} disabled={bulkUpdate.isPending}>
                  Discard
                </Button>
              </div>
            ) : null}
          </>
        ) : null}
        <div className="ml-auto flex items-center gap-sm">
          {viewMode === 'rows' && countQuery.data ? (
            <span className="text-xs text-text-faint">
              {filterKey ? '' : '~'}{countQuery.data.totalRows.toLocaleString()} rows
            </span>
          ) : null}
          <div className="flex overflow-hidden rounded-sm border border-border">
            <Button
              type="button"
              variant={viewMode === 'rows' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => onViewModeChange('rows')}
              className="rounded-none border-0"
            >
              Rows
            </Button>
            <div className="w-px bg-border" />
            <Button
              type="button"
              variant={viewMode === 'structure' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => onViewModeChange('structure')}
              className="rounded-none border-0"
            >
              Structure
            </Button>
          </div>
        </div>
      </div>
      {viewMode === 'rows' && filterOpen ? (
        <FilterPanel
          columns={columnsQuery.data?.columns ?? []}
          activeFilter={activeFilter}
          onChange={setActiveFilter}
        />
      ) : null}
      <div className="min-h-0 flex-1">
        {viewMode === 'structure' ? (
          <TableStructurePanel connectionId={connectionId} schema={schema} table={table} writable={writable} />
        ) : columnsQuery.isLoading ? (
          <div className="flex h-full items-center justify-center text-sm text-text-faint">Loading table…</div>
        ) : columnsQuery.isError ? (
          <div className="flex h-full items-center justify-center text-sm text-danger">Failed to load table.</div>
        ) : (
          <div className="h-full" onKeyDown={onGridKeyDown}>
            <AgGridReact
              key={`${connectionId}.${schema}.${table}`}
              theme={prostGridTheme}
              columnDefs={columnDefs}
              rowModelType="infinite"
              datasource={datasource}
              cacheBlockSize={PAGE_SIZE}
              maxBlocksInCache={10}
              getRowId={getRowId}
              pinnedTopRowData={pinnedTopRowData}
              rowSelection={editable ? { mode: 'multiRow', checkboxes: true, headerCheckbox: false } : undefined}
              onGridReady={onGridReady}
              onSelectionChanged={onSelectionChanged}
              onCellValueChanged={onCellValueChanged}
            />
          </div>
        )}
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
