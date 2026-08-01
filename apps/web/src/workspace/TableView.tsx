import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AgGridReact } from 'ag-grid-react';
import type {
  CellClickedEvent,
  CellContextMenuEvent,
  CellValueChangedEvent,
  GetRowIdParams,
  GridApi,
  GridReadyEvent,
  IDatasource,
  IGetRowsParams,
  IRowNode,
  SelectionChangedEvent,
} from 'ag-grid-community';
import { Columns3, CopyPlus, Download, Eye, EyeOff, Filter, Plus, Redo2, RefreshCw, Save, Search, Trash2, Undo2, Upload, X } from 'lucide-react';
import type { BulkRowEdit, ColumnMetadata, ColumnRenderMode, FilterOperator, GridResponse, RowConcurrency, RowFilter } from '@prost/shared-types';
import { ROW_VERSION_KEY } from '@prost/shared-types';
import { Badge, Button, GRID_DENSITY_ROW_HEIGHT, IconButton, Input, SkeletonRows, Tooltip, prostGridTheme, Toast } from '@prost/ui';
import { FilterPanel, operatorsForColumn } from './FilterPanel';
import { ExportDialog } from './ExportDialog';
import { ImportModal } from '../import/ImportModal';
import { TableStructurePanel } from './TableStructurePanel';
import { TableProfilePanel } from './TableProfilePanel';
import { useConnection } from '../api/connections';
import { useBulkUpdate, useDeleteRow, useInsertRow } from '../api/grid';
import { useUpdatePreferences } from '../api/preferences';
import { buildColumnDefs, type HeaderContextMenuArgs } from '../grid/columnDefs';
import { CellContextMenu, type CellMenuItem, type CellMenuState } from '../grid/CellContextMenu';
import { rowToJson, rowsToTsv } from '../grid/clipboard';
import { buildFkNavTargets } from '../grid/fkNavigation';
import { ColumnRenderMenu } from '../grid/ColumnRenderMenu';
import { JsonCellPopup } from '../grid/JsonCellPopup';
import { useEditBuffer } from '../grid/useEditBuffer';
import { useConfirm } from '../hooks/useConfirm';
import { useToasts } from '../hooks/useToasts';
import { formatChord, matchesChord, resolveBinding } from '../keybindings';
import { ApiError, apiErrorDetail, apiFetch } from '../lib/apiClient';
import { useThemeStore } from '../stores/themeStore';
import { useWorkspaceStore } from '../stores/workspaceStore';

/** Text-family column types the cross-column search targets (mirrors the server's `TEXT_TYPES`). */
const TEXT_TYPES = new Set([
  'text', 'character varying', 'character', 'name', 'citext', 'varchar', 'char', 'bpchar',
  'tinytext', 'mediumtext', 'longtext', 'enum', 'set', 'text/blob',
]);

/**
 * Builds an OR-of-`contains` filter across every text column, so a single term matches any text
 * field. Non-text columns are skipped (the `contains` operator is only valid for text). Returns
 * `null` for a blank term or a table with no text columns (clears the filter).
 */
function buildSearchFilter(term: string, columns: ColumnMetadata[]): RowFilter | null {
  const trimmed = term.trim();
  if (!trimmed) return null;
  const textColumns = columns.filter((column) => TEXT_TYPES.has(column.dataType.toLowerCase()));
  if (textColumns.length === 0) return null;
  return {
    combinator: 'or',
    conditions: textColumns.map((column) => ({ column: column.name, operator: 'contains', value: trimmed })),
  };
}

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
  viewMode: 'rows' | 'structure' | 'profile';
  onViewModeChange: (mode: 'rows' | 'structure' | 'profile') => void;
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
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [activeFilter, setActiveFilter] = useState<RowFilter | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [lastEdit, setLastEdit] = useState<{ column: string; value: unknown } | null>(null);
  const [undoStack, setUndoStack] = useState<UndoRow[][]>([]);
  const [redoStack, setRedoStack] = useState<UndoRow[][]>([]);
  const [renderMenu, setRenderMenu] = useState<HeaderContextMenuArgs | null>(null);
  const [cellMenu, setCellMenu] = useState<CellMenuState | null>(null);
  const [jsonCell, setJsonCell] = useState<{ column: string; value: unknown } | null>(null);
  /** Per-session unmasking (Phase 39) — never persisted; a reload masks again. */
  const [revealed, setRevealed] = useState(false);
  /** Drives the refresh icon's spin (Phase 40) — a minimum visible duration so an instant refresh still registers. */
  const [refreshing, setRefreshing] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);
  const openTable = useWorkspaceStore((state) => state.openTable);
  const { toasts, push: pushToast, dismiss: dismissToast } = useToasts();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const editBuffer = useEditBuffer();
  const keybindings = useThemeStore((state) => state.keybindings);

  // Mirrors this tab's dirty-edit state into the workspace store (Phase 40), so the tab bar can
  // warn before discarding unsaved edits on close. Only the active tab's `TableView` is mounted, so
  // this is always this tab's own state; cleared on unmount so a stale `true` never lingers.
  const setActiveTabDirty = useWorkspaceStore((state) => state.setActiveTabDirty);
  useEffect(() => {
    setActiveTabDirty(editBuffer.dirtyCells > 0);
  }, [editBuffer.dirtyCells, setActiveTabDirty]);
  useEffect(() => () => setActiveTabDirty(false), [setActiveTabDirty]);

  // Per-column "render as" overrides for this table (server-backed, keyed connection → schema.table).
  const sourceTable = `${schema}.${table}`;
  const renderOverrides = useThemeStore((state) => state.columnRenderOverrides[connectionId]?.[sourceTable]);
  const setColumnRenderOverride = useThemeStore((state) => state.setColumnRenderOverride);
  // Masked columns for this table (Phase 39). The store mirror drives the menu + settings roster;
  // what the grid actually shows is whatever the *server* chose to redact.
  const maskedHere = useThemeStore((state) => state.maskedColumns[connectionId]?.[sourceTable]);
  const setColumnMasked = useThemeStore((state) => state.setColumnMasked);
  // Explicit density-driven heights so a density change applies live (AG Grid caches the theme's
  // auto row height until reload) and centers cell text via the derived `--ag-line-height`.
  const gridDensity = useThemeStore((state) => state.gridDensity);
  const rowHeight = GRID_DENSITY_ROW_HEIGHT[gridDensity];
  const gridPrefs = useThemeStore((state) => state.grid);
  const pageSize = gridPrefs.pageSize ?? PAGE_SIZE;
  const updatePreferences = useUpdatePreferences();

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
  // Resolve from this tab's *bound* connection, not the active one — the tab may be for a
  // different connection than the one currently selected in the sidebar.
  const tabConnection = useConnection(connectionId);
  const writable = !tabConnection?.capabilities.readOnly;
  const editable = (columnsQuery.data?.editable ?? false) && writable;
  const primaryKey = columnsQuery.data?.primaryKey ?? [];
  const concurrency: RowConcurrency = columnsQuery.data?.concurrency ?? 'preimage';

  const insertRow = useInsertRow(connectionId, schema, table);
  const deleteRow = useDeleteRow(connectionId, schema, table);
  const bulkUpdate = useBulkUpdate(connectionId, schema, table);

  // Cross-column search: update the box immediately, debounce the (fetch-triggering) filter apply.
  const applySearch = useCallback(
    (term: string) => {
      setSearchTerm(term);
      if (searchTimer.current) clearTimeout(searchTimer.current);
      const columns = columnsQuery.data?.columns ?? [];
      searchTimer.current = setTimeout(() => setActiveFilter(buildSearchFilter(term, columns)), 250);
    },
    [columnsQuery.data],
  );

  // One-shot hand-off from the database overview's "Search" action: focus the box (seeded term).
  const tabId = `table:${connectionId}:${schema}.${table}`;
  const searchHandoff = useWorkspaceStore((state) => state.tabs.find((tab) => tab.id === tabId)?.search);
  const clearTabSearch = useWorkspaceStore((state) => state.clearTabSearch);
  useEffect(() => {
    if (searchHandoff === undefined) return;
    clearTabSearch(tabId);
    applySearch(searchHandoff);
    requestAnimationFrame(() => searchInputRef.current?.focus());
  }, [searchHandoff, tabId, clearTabSearch, applySearch]);

  // One-shot hand-off from FK relational navigation: apply the preset filter and reveal the panel.
  const presetFilter = useWorkspaceStore((state) => state.tabs.find((tab) => tab.id === tabId)?.presetFilter);
  const clearTabFilter = useWorkspaceStore((state) => state.clearTabFilter);
  useEffect(() => {
    if (!presetFilter) return;
    clearTabFilter(tabId);
    setActiveFilter(presetFilter);
    setFilterOpen(true);
  }, [presetFilter, tabId, clearTabFilter]);

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
    () =>
      columnsQuery.data
        ? buildColumnDefs(columnsQuery.data.columns, editable, {
            renderOverrides,
            onHeaderContextMenu: setRenderMenu,
            display: gridPrefs,
            // What the *server* redacted, not the local mirror — a revealed read reports none.
            masked: new Set(columnsQuery.data.maskedColumns ?? []),
          })
        : [],
    [columnsQuery.data, editable, renderOverrides, gridPrefs],
  );

  const handleSelectRenderMode = useCallback(
    (mode: ColumnRenderMode | null) => {
      if (!renderMenu) return;
      const next = setColumnRenderOverride(connectionId, sourceTable, renderMenu.field, mode);
      updatePreferences.mutate(
        { columnRenderOverrides: next },
        { onError: (error) => pushToast('danger', apiErrorDetail(error, 'Failed to save display preference.')) },
      );
    },
    [renderMenu, setColumnRenderOverride, connectionId, sourceTable, updatePreferences, pushToast],
  );

  // Mark/unmark a column sensitive (Phase 39). Only persists — `useUpdatePreferences` invalidates the
  // grid read on success, and the effect below drops the cached rows, so this works the same whether
  // the change came from here or from the Settings roster.
  const handleToggleMask = useCallback(
    (masked: boolean) => {
      if (!renderMenu) return;
      const next = setColumnMasked(connectionId, sourceTable, renderMenu.field, masked);
      updatePreferences.mutate(
        { maskedColumns: next },
        { onError: (error) => pushToast('danger', apiErrorDetail(error, 'Failed to save masking preference.')) },
      );
    },
    [renderMenu, setColumnMasked, connectionId, sourceTable, updatePreferences, pushToast],
  );

  // Rows live in AG Grid's infinite cache, which a query invalidation doesn't reach. Watch what the
  // *server* says is masked (not the local store mirror, which changes before the write lands) and
  // drop the cached rows whenever it changes, so masking applied anywhere shows up here.
  const serverMaskedKey = (columnsQuery.data?.maskedColumns ?? []).join(',');
  const maskingSettled = useRef(false);
  useEffect(() => {
    if (!maskingSettled.current) {
      maskingSettled.current = true;
      return;
    }
    gridApiRef.current?.refreshInfiniteCache();
  }, [serverMaskedKey]);

  /** Whether this table has any masked columns at all — gates the Reveal affordance. */
  const hasMasked = (maskedHere?.length ?? 0) > 0;

  // Revealing shows values the user deliberately hid, and the server audits it — so it asks first.
  const handleToggleReveal = useCallback(async () => {
    if (revealed) {
      setRevealed(false);
      gridApiRef.current?.refreshInfiniteCache();
      return;
    }
    const ok = await confirm({
      title: 'Reveal masked columns?',
      description:
        'Values in masked columns will be shown for the rest of this session, and the reveal is recorded in the audit log. Reloading masks them again.',
      confirmLabel: 'Reveal',
    });
    if (!ok) return;
    setRevealed(true);
    gridApiRef.current?.refreshInfiniteCache();
  }, [revealed, confirm]);

  const onCellClicked = useCallback(
    (event: CellClickedEvent) => {
      const colId = event.column.getColId();
      if (renderOverrides?.[colId] === 'json') {
        setJsonCell({ column: colId, value: event.value });
      }
    },
    [renderOverrides],
  );

  // From a column header's context menu: add an inline filter on that column (contains for text,
  // exact for other types) and reveal the filter panel so it can be edited/removed.
  const handleFilterColumn = useCallback(
    (term: string) => {
      if (!renderMenu) return;
      const column = columnsQuery.data?.columns.find((c) => c.name === renderMenu.field);
      const validOps = column ? operatorsForColumn(column) : (['eq'] as FilterOperator[]);
      const operator: FilterOperator = validOps.includes('contains') ? 'contains' : validOps[0] ?? 'eq';
      const condition = { column: renderMenu.field, operator, value: term };
      setActiveFilter((prev) => {
        const base = prev ?? { conditions: [], combinator: 'and' as const };
        return { ...base, conditions: [...base.conditions, condition] };
      });
      setFilterOpen(true);
    },
    [renderMenu, columnsQuery.data],
  );

  // Sets a cell to NULL through the same staged-edit path a manual grid edit takes (Phase 40's cell
  // menu "Set NULL" action) — it shows up in the dirty-cells count and undo stack like any edit.
  const handleSetNull = useCallback(
    (colId: string, row: Record<string, unknown>) => {
      const key = rowKeyOf(row);
      editBuffer.stage(key, identityOf(row), colId, row[colId], null);
      gridApiRef.current?.getRowNode(key)?.setDataValue(colId, null);
    },
    [rowKeyOf, identityOf, editBuffer],
  );

  // Adds an `eq` filter on this cell's column + value (Phase 40's cell menu "Filter by this value").
  const handleFilterByValue = useCallback(
    (colId: string, value: unknown) => {
      const column = columnsQuery.data?.columns.find((c) => c.name === colId);
      const validOps = column ? operatorsForColumn(column) : (['eq'] as FilterOperator[]);
      const operator: FilterOperator = validOps.includes('eq') ? 'eq' : (validOps[0] ?? 'eq');
      const condition = { column: colId, operator, value };
      setActiveFilter((prev) => {
        const base = prev ?? { conditions: [], combinator: 'and' as const };
        return { ...base, conditions: [...base.conditions, condition] };
      });
      setFilterOpen(true);
    },
    [columnsQuery.data],
  );

  // Builds the cell context menu (Phase 40): generic actions (copy/filter/set-null) always show, so
  // every cell — not just FK ones — has a menu; FK relational-navigation targets (forward "open
  // referenced row" + reverse "show referencing rows") follow after a separator when present. Each FK
  // target compiles to a parameterized `and`/`eq` RowFilter — the same path Phase 14 validates — and
  // opens the target table as a tab seeded with that filter.
  const buildCellMenuItems = useCallback(
    (colId: string, row: Record<string, unknown>): CellMenuItem[] => {
      const columns = columnsQuery.data?.columns ?? [];
      const columnNames = columns.map((c) => c.name);
      const column = columns.find((c) => c.name === colId);
      const isMasked = (columnsQuery.data?.maskedColumns ?? []).includes(colId);
      const value = row[colId];

      const generic: CellMenuItem[] = [
        { kind: 'copy', label: 'Copy value', onSelect: () => void navigator.clipboard.writeText(String(value ?? '')) },
        { kind: 'copy', label: 'Copy row (TSV)', onSelect: () => void navigator.clipboard.writeText(rowsToTsv([row], columnNames)) },
        { kind: 'copy', label: 'Copy row (JSON)', onSelect: () => void navigator.clipboard.writeText(rowToJson(row, columnNames)) },
        { kind: 'filter', label: 'Filter by this value', onSelect: () => handleFilterByValue(colId, value) },
      ];
      if (editable && !isMasked && column && !column.isPrimaryKey) {
        generic.push({ kind: 'setNull', label: 'Set NULL', onSelect: () => handleSetNull(colId, row) });
      }

      const fkTargets = buildFkNavTargets(
        colId,
        row,
        columnsQuery.data?.foreignKeys ?? [],
        columnsQuery.data?.referencingKeys ?? [],
        schema,
        // A masked cell holds a token, not the key — navigating on it would find nothing.
        new Set(columnsQuery.data?.maskedColumns ?? []),
      ).map((target, i) => ({
        direction: target.direction,
        label: target.label,
        separatorBefore: i === 0,
        onSelect: () => openTable(connectionId, target.schema, target.table, 'rows', { filter: target.filter }),
      }));

      return [...generic, ...fkTargets];
    },
    [columnsQuery.data, openTable, schema, connectionId, editable, handleFilterByValue, handleSetNull],
  );

  // AG Grid gives us the row + column reliably on right-click; open the FK menu on FK cells. The
  // browser's own context menu is suppressed grid-wide by the `preventDefaultOnContextMenu` grid
  // option (AG Grid calls preventDefault itself, at the right time — no event-timing races).
  const onCellContextMenu = useCallback(
    (event: CellContextMenuEvent) => {
      const row = event.data as Record<string, unknown> | undefined;
      if (!row) return;
      const items = buildCellMenuItems(event.column.getColId(), row);
      if (items.length === 0) return;
      const native = event.event as MouseEvent | undefined;
      setCellMenu({ x: native?.clientX ?? 0, y: native?.clientY ?? 0, items });
    },
    [buildCellMenuItems],
  );

  // Mobile parity (principle §9): a long-press on an FK cell opens the same menu.
  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;
      const target = e.target as HTMLElement;
      const cell = target.closest<HTMLElement>('.ag-cell');
      const rowEl = target.closest<HTMLElement>('.ag-row');
      const colId = cell?.getAttribute('col-id');
      const rowIndex = rowEl ? Number(rowEl.getAttribute('row-index')) : NaN;
      // A pinned row (the pending-insert top row) reuses row-index 0 in its own container, so an
      // index lookup would resolve the wrong body row — it isn't a navigable source anyway, skip it.
      if (!colId || Number.isNaN(rowIndex) || rowEl?.getAttribute('row-pinned')) return;
      const { clientX, clientY } = touch;
      cancelLongPress();
      longPressTimer.current = setTimeout(() => {
        const data = gridApiRef.current?.getDisplayedRowAtIndex(rowIndex)?.data as Record<string, unknown> | undefined;
        if (!data) return;
        const items = buildCellMenuItems(colId, data);
        if (items.length > 0) {
          longPressFired.current = true;
          setCellMenu({ x: clientX, y: clientY, items });
        }
      }, 500);
    },
    [buildCellMenuItems, cancelLongPress],
  );

  // On release after a long-press that opened the menu, suppress the browser-synthesized click —
  // otherwise it would fire on the just-opened menu (closing it or triggering its first item).
  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      cancelLongPress();
      if (longPressFired.current) {
        e.preventDefault();
        longPressFired.current = false;
      }
    },
    [cancelLongPress],
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
        // Per-session reveal (Phase 39): the server redacts unless this asks otherwise, and audits it.
        if (revealed) search.set('reveal', 'true');
        apiFetch<GridResponse>(rowsUrl(connectionId, schema, table, search))
          .then((response) => {
            const lastRow = response.rows.length < limit ? offset + response.rows.length : undefined;
            params.successCallback(response.rows, lastRow);
          })
          .catch(() => params.failCallback());
      },
    }),
    [connectionId, schema, table, activeFilter, revealed],
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
        const flashedNodes = entries
          .map(([rowKey]) => gridApiRef.current?.getRowNode(rowKey))
          .filter((n): n is IRowNode => !!n);
        gridApiRef.current?.flashCells({ rowNodes: flashedNodes });
        pushToast('success', `Saved ${entries.length} edit${entries.length === 1 ? '' : 's'}.`);
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

  // Refresh feedback (Phase 40): a minimum visible spin so an instant refresh still reads as
  // "something happened", matching the `isFetching`-driven spin in SessionsPanel/AuditPanel.
  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    gridApiRef.current?.refreshInfiniteCache();
    window.setTimeout(() => setRefreshing(false), 500);
  }, []);

  // Command-palette view-action hand-off (Phase 40: "Refresh current view" / "Export current
  // table"). Only the active tab's view is mounted, so no per-tab scoping is needed here.
  const viewActionRequest = useWorkspaceStore((state) => state.viewActionRequest);
  const clearViewActionRequest = useWorkspaceStore((state) => state.clearViewActionRequest);
  useEffect(() => {
    if (!viewActionRequest || viewMode !== 'rows') return;
    if (viewActionRequest === 'refresh') handleRefresh();
    else setExportOpen(true);
    clearViewActionRequest();
  }, [viewActionRequest, viewMode, handleRefresh, clearViewActionRequest]);

  // `mod+c` (Phase 40): selected rows copy as TSV (with a header row); with no selection, the
  // focused cell copies its bare value. AG Grid Community has no clipboard module of its own.
  const handleCopy = useCallback(() => {
    const columns = (columnsQuery.data?.columns ?? []).map((c) => c.name);
    if (selectedRows.length > 0) {
      void navigator.clipboard.writeText(rowsToTsv(selectedRows, columns));
      pushToast('success', `Copied ${selectedRows.length} row${selectedRows.length === 1 ? '' : 's'}.`);
      return;
    }
    const focused = gridApiRef.current?.getFocusedCell();
    if (!focused) return;
    const rowNode = gridApiRef.current?.getDisplayedRowAtIndex(focused.rowIndex);
    const data = rowNode?.data as Record<string, unknown> | undefined;
    if (!data) return;
    void navigator.clipboard.writeText(String(data[focused.column.getColId()] ?? ''));
    pushToast('success', 'Copied cell value.');
  }, [columnsQuery.data, selectedRows, pushToast]);

  const onGridKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      const native = event.nativeEvent;
      if (editable && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) handleRedo();
        else handleUndo();
        return;
      }
      if (matchesChord(native, resolveBinding('find-in-grid', keybindings))) {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (matchesChord(native, resolveBinding('copy-cells', keybindings))) {
        event.preventDefault();
        handleCopy();
        return;
      }
      if (editable && editBuffer.dirtyCells > 0 && matchesChord(native, resolveBinding('save-edits', keybindings))) {
        event.preventDefault();
        handleSave();
      }
      // `refresh-view` is handled globally (AppLayout), not here — refreshing shouldn't require
      // focus to already be inside the grid, unlike the grid-scoped shortcuts above.
    },
    [editable, handleRedo, handleUndo, keybindings, handleCopy, editBuffer.dirtyCells, handleSave],
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
          pushToast('success', 'Row inserted.');
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
      const succeeded = results.length - failed.length;
      if (failed.length > 0) {
        const message =
          failed.length === 1
            ? apiErrorDetail(failed[0]!.reason, 'Failed to delete row.')
            : `Failed to delete ${failed.length} of ${selectedRows.length} rows.`;
        pushToast('danger', message);
      }
      if (succeeded > 0) pushToast('success', `Deleted ${succeeded} row${succeeded === 1 ? '' : 's'}.`);
      gridApiRef.current?.deselectAll();
      gridApiRef.current?.refreshInfiniteCache();
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        role="toolbar"
        aria-label="Table actions"
        className="flex h-8 max-md:h-11 shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-surface px-sm [&>*]:shrink-0"
      >
        {viewMode === 'rows' ? (
          <>
            <Tooltip content="Refresh data" shortcut={formatChord(resolveBinding('refresh-view', keybindings))}>
              <IconButton aria-label="Refresh rows" onClick={handleRefresh}>
                <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
              </IconButton>
            </Tooltip>
            <Tooltip content="Filter rows">
              <IconButton
                aria-label="Filter rows"
                onClick={() => setFilterOpen((open) => !open)}
                className="relative"
              >
                <Filter size={14} />
                {(activeFilter?.conditions.length ?? 0) > 0 ? (
                  <Badge variant="neutral" className="absolute -right-1 -top-1 h-4 min-w-4 px-0.5 text-[10px] leading-none">
                    {activeFilter!.conditions.length}
                  </Badge>
                ) : null}
              </IconButton>
            </Tooltip>
            <div className="relative">
              <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-text-faint" />
              <Input
                ref={searchInputRef}
                type="text"
                value={searchTerm}
                onChange={(e) => applySearch(e.target.value)}
                placeholder="Search all columns…"
                aria-label="Search all columns"
                className="h-7 w-40 pl-7 pr-6 text-xs max-md:w-32"
              />
              {searchTerm ? (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => applySearch('')}
                  className="absolute right-1.5 top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded-sm text-text-faint hover:bg-surface-hover hover:text-text"
                >
                  <X size={12} />
                </button>
              ) : null}
            </div>
            <div className="mx-1 h-4 w-px bg-border" />
            <Tooltip content="Add row">
              <IconButton aria-label="Add row" onClick={handleAddRow} disabled={!editable || pendingInsert !== null}>
                <Plus size={14} />
              </IconButton>
            </Tooltip>
            <Tooltip content="Delete selected rows">
              <IconButton
                aria-label="Delete selected rows"
                onClick={handleDeleteSelected}
                disabled={!editable || selectedRows.length === 0}
              >
                <Trash2 size={14} />
              </IconButton>
            </Tooltip>
            {writable ? (
              <Tooltip content="Import CSV into this table">
                <IconButton aria-label="Import CSV" onClick={() => setImportOpen(true)}>
                  <Upload size={14} />
                </IconButton>
              </Tooltip>
            ) : null}
            <Tooltip content="Save new row">
              <IconButton
                aria-label="Save new row"
                onClick={handleSaveInsert}
                disabled={pendingInsert === null || insertRow.isPending}
              >
                <Save size={14} />
              </IconButton>
            </Tooltip>
            {pendingInsert !== null ? (
              <Tooltip content="Cancel new row">
                <IconButton aria-label="Cancel new row" onClick={handleCancelInsert}>
                  <X size={14} />
                </IconButton>
              </Tooltip>
            ) : null}
            <div className="mx-1 h-4 w-px bg-border" />
            <Tooltip content="Apply last edit to selected rows">
              <IconButton
                aria-label="Apply last edit to selected rows"
                onClick={handleApplyToSelected}
                disabled={!editable || lastEdit === null || selectedRows.length === 0}
              >
                <CopyPlus size={14} />
              </IconButton>
            </Tooltip>
            <Tooltip content="Undo">
              <IconButton aria-label="Undo" onClick={handleUndo} disabled={undoStack.length === 0}>
                <Undo2 size={14} />
              </IconButton>
            </Tooltip>
            <Tooltip content="Redo">
              <IconButton aria-label="Redo" onClick={handleRedo} disabled={redoStack.length === 0}>
                <Redo2 size={14} />
              </IconButton>
            </Tooltip>
            <div className="mx-1 h-4 w-px bg-border" />
            <Tooltip content="Auto-size columns">
              <IconButton
                aria-label="Auto-size columns"
                onClick={() => gridApiRef.current?.autoSizeAllColumns()}
              >
                <Columns3 size={14} />
              </IconButton>
            </Tooltip>
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
          {viewMode === 'rows' && hasMasked ? (
            <Tooltip content={revealed ? 'Hide masked columns' : 'Reveal masked columns for this session'}>
              <IconButton
                aria-label={revealed ? 'Hide masked columns' : 'Reveal masked columns'}
                variant={revealed ? 'active' : 'ghost'}
                onClick={() => void handleToggleReveal()}
              >
                {revealed ? <Eye size={14} /> : <EyeOff size={14} />}
              </IconButton>
            </Tooltip>
          ) : null}
          {viewMode === 'rows' ? (
            <Tooltip content="Export table">
              <IconButton aria-label="Export" onClick={() => setExportOpen(true)}>
                <Download size={14} />
              </IconButton>
            </Tooltip>
          ) : null}
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
            <div className="w-px bg-border" />
            <Button
              type="button"
              variant={viewMode === 'profile' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => onViewModeChange('profile')}
              className="rounded-none border-0"
            >
              Profile
            </Button>
          </div>
        </div>
      </div>
      {viewMode === 'rows' && filterOpen ? (
        <FilterPanel
          columns={columnsQuery.data?.columns ?? []}
          activeFilter={activeFilter}
          onChange={setActiveFilter}
          onRequestClose={() => setFilterOpen(false)}
        />
      ) : null}
      <div className="min-h-0 flex-1" role="region" aria-label={`${schema}.${table} data`}>
        {viewMode === 'structure' ? (
          <TableStructurePanel connectionId={connectionId} schema={schema} table={table} writable={writable} />
        ) : viewMode === 'profile' ? (
          <TableProfilePanel connectionId={connectionId} schema={schema} table={table} />
        ) : columnsQuery.isLoading ? (
          <SkeletonRows />
        ) : columnsQuery.isError ? (
          <div className="flex h-full items-center justify-center text-sm text-danger">Failed to load table.</div>
        ) : (
          <div
            className="h-full"
            onKeyDown={onGridKeyDown}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
            onTouchMove={cancelLongPress}
            onTouchCancel={cancelLongPress}
          >
            <AgGridReact
              key={`${connectionId}.${schema}.${table}`}
              theme={prostGridTheme}
              rowHeight={rowHeight}
              headerHeight={rowHeight}
              columnDefs={columnDefs}
              rowModelType="infinite"
              datasource={datasource}
              cacheBlockSize={pageSize}
              maxBlocksInCache={10}
              getRowId={getRowId}
              pinnedTopRowData={pinnedTopRowData}
              rowSelection={editable ? { mode: 'multiRow', checkboxes: true, headerCheckbox: false } : undefined}
              // AG Grid calls preventDefault on cell right-clicks, reliably suppressing the browser's
              // context menu so only our FK menu (opened in onCellContextMenu) shows.
              preventDefaultOnContextMenu
              enableCellTextSelection
              tooltipShowDelay={500}
              onGridReady={onGridReady}
              onSelectionChanged={onSelectionChanged}
              onCellValueChanged={onCellValueChanged}
              onCellClicked={onCellClicked}
              onCellContextMenu={onCellContextMenu}
            />
          </div>
        )}
      </div>
      <ColumnRenderMenu
        state={renderMenu}
        masked={renderMenu ? (maskedHere ?? []).includes(renderMenu.field) : false}
        onToggleMask={handleToggleMask}
        currentMode={renderMenu ? renderOverrides?.[renderMenu.field] : undefined}
        onSelect={handleSelectRenderMode}
        onFilterColumn={handleFilterColumn}
        onClose={() => setRenderMenu(null)}
      />
      <CellContextMenu state={cellMenu} onClose={() => setCellMenu(null)} />
      <JsonCellPopup cell={jsonCell} onClose={() => setJsonCell(null)} />
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-sm p-md sm:items-end">
        {toasts.map((toast) => (
          <div key={toast.id} className="pointer-events-auto w-full max-w-[24rem]">
            <Toast variant={toast.variant} message={toast.message} onDismiss={() => dismissToast(toast.id)} />
          </div>
        ))}
      </div>
      {confirmDialog}
      <ExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        connectionId={connectionId}
        target={{ scope: 'table', schema, table, ...(activeFilter ? { filter: activeFilter } : {}) }}
      />
      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        connectionId={connectionId}
        schema={schema}
        table={table}
        columns={columnsQuery.data?.columns ?? []}
        onImported={() => gridApiRef.current?.refreshInfiniteCache()}
      />
    </div>
  );
}
