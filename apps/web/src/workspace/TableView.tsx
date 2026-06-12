import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AgGridReact } from 'ag-grid-react';
import type { IDatasource, IGetRowsParams } from 'ag-grid-community';
import { ArrowUpDown, Filter, Plus, Save, Trash2 } from 'lucide-react';
import type { GridResponse } from '@prost/shared-types';
import { IconButton, prostGridTheme } from '@prost/ui';
import { buildColumnDefs } from '../grid/columnDefs';
import { apiFetch } from '../lib/apiClient';

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
  const columnsQuery = useQuery({
    queryKey: ['grid-columns', connectionId, schema, table],
    queryFn: () => apiFetch<GridResponse>(rowsUrl(connectionId, schema, table, new URLSearchParams({ limit: '1', offset: '0' }))),
  });

  const columnDefs = useMemo(
    () => (columnsQuery.data ? buildColumnDefs(columnsQuery.data.columns) : []),
    [columnsQuery.data],
  );

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

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border bg-surface px-sm">
        <IconButton aria-label="Filter rows">
          <Filter size={14} />
        </IconButton>
        <IconButton aria-label="Sort rows">
          <ArrowUpDown size={14} />
        </IconButton>
        <div className="mx-1 h-4 w-px bg-border" />
        <IconButton aria-label="Add row">
          <Plus size={14} />
        </IconButton>
        <IconButton aria-label="Delete selected rows">
          <Trash2 size={14} />
        </IconButton>
        <IconButton aria-label="Save changes">
          <Save size={14} />
        </IconButton>
        {columnsQuery.data ? (
          <span className="ml-auto text-xs text-text-faint">~{columnsQuery.data.totalRows.toLocaleString()} rows</span>
        ) : null}
      </div>
      <div className="min-h-0 flex-1">
        {columnsQuery.isLoading ? (
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
          />
        )}
      </div>
    </div>
  );
}
