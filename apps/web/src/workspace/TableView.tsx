import { useMemo } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { ArrowUpDown, Filter, Plus, Save, Trash2 } from 'lucide-react';
import { IconButton, prostGridTheme } from '@prost/ui';
import { buildColumnDefs } from '../grid/columnDefs';
import { usersGridResponse } from '../mocks/users';

export function TableView() {
  const columnDefs = useMemo(() => buildColumnDefs(usersGridResponse.columns), []);

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
      </div>
      <div className="min-h-0 flex-1">
        <AgGridReact theme={prostGridTheme} columnDefs={columnDefs} rowData={usersGridResponse.rows} />
      </div>
    </div>
  );
}
