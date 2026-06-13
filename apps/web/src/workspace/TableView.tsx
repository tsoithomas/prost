import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { Filter, Plus, Save, Trash2, X } from 'lucide-react';
import type { GridResponse } from '@prost/shared-types';
import { Button, IconButton, prostGridTheme, Toast } from '@prost/ui';
import { TableStructurePanel } from './TableStructurePanel';
import { useDeleteRow, useInsertRow, useUpdateCell } from '../api/grid';
import { buildColumnDefs } from '../grid/columnDefs';
import { useConfirm } from '../hooks/useConfirm';
import { useToasts } from '../hooks/useToasts';
import { apiErrorDetail, apiFetch } from '../lib/apiClient';

export interface TableViewProps {
  connectionId: string;
  schema: string;
  table: string;
}

const PAGE_SIZE = 100;

function rowsUrl(connectionId: string, schema: string, table: string, search: URLSearchParams): string {
  return `/connections/${connectionId}/tables/${encodeURIComponent(schema)}/${encodeURIComponent(table)}/rows?${search}`;
}

export function TableView({ connectionId, schema, table }: TableViewProps) {
  const gridApiRef = useRef<GridApi | null>(null);
  const [pendingInsert, setPendingInsert] = useState<Record<string, unknown> | null>(null);
  const [selectedRows, setSelectedRows] = useState<Record<string, unknown>[]>([]);
  const [viewMode, setViewMode] = useState<'rows' | 'structure'>('rows');
  const { toasts, push: pushToast, dismiss: dismissToast } = useToasts();
  const { confirm, dialog: confirmDialog } = useConfirm();

  useEffect(() => {
    setViewMode('rows');
  }, [schema, table]);

  const columnsQuery = useQuery({
    queryKey: ['grid-columns', connectionId, schema, table],
    queryFn: () => apiFetch<GridResponse>(rowsUrl(connectionId, schema, table, new URLSearchParams({ limit: '1', offset: '0' }))),
  });

  const editable = columnsQuery.data?.editable ?? false;
  const primaryKey = columnsQuery.data?.primaryKey ?? [];

  const updateCell = useUpdateCell(connectionId, schema, table);
  const insertRow = useInsertRow(connectionId, schema, table);
  const deleteRow = useDeleteRow(connectionId, schema, table);

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
        apiFetch<GridResponse>(rowsUrl(connectionId, schema, table, search))
          .then((response) => {
            const lastRow = response.rows.length < limit ? offset + response.rows.length : undefined;
            params.successCallback(response.rows, lastRow);
          })
          .catch(() => params.failCallback());
      },
    }),
    [connectionId, schema, table],
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
      gridApiRef.current?.deselectAll();
      gridApiRef.current?.refreshInfiniteCache();
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex h-8 max-md:h-11 shrink-0 items-center gap-1 border-b border-border bg-surface px-sm">
        {viewMode === 'rows' ? (
          <>
            <IconButton aria-label="Filter rows" disabled title="Filtering — coming soon">
              <Filter size={14} />
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
          </>
        ) : null}
        <div className="ml-auto flex items-center gap-sm">
          {viewMode === 'rows' && columnsQuery.data ? (
            <span className="text-xs text-text-faint">~{columnsQuery.data.totalRows.toLocaleString()} rows</span>
          ) : null}
          <div className="flex overflow-hidden rounded-sm border border-border">
            <Button
              type="button"
              variant={viewMode === 'rows' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('rows')}
              className="rounded-none border-0"
            >
              Rows
            </Button>
            <div className="w-px bg-border" />
            <Button
              type="button"
              variant={viewMode === 'structure' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('structure')}
              className="rounded-none border-0"
            >
              Structure
            </Button>
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {viewMode === 'structure' ? (
          <TableStructurePanel connectionId={connectionId} schema={schema} table={table} />
        ) : columnsQuery.isLoading ? (
          <div className="flex h-full items-center justify-center text-sm text-text-faint">Loading table…</div>
        ) : columnsQuery.isError ? (
          <div className="flex h-full items-center justify-center text-sm text-danger">Failed to load table.</div>
        ) : (
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
        )}
      </div>
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-sm p-md sm:items-end">
        {toasts.map((toast) => (
          <div key={toast.id} className="pointer-events-auto w-full max-w-sm">
            <Toast variant={toast.variant} message={toast.message} onDismiss={() => dismissToast(toast.id)} />
          </div>
        ))}
      </div>
      {confirmDialog}
    </div>
  );
}
