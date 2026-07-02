import { Eraser, Rows3, Search, StretchHorizontal, Table2, Trash2 } from 'lucide-react';
import type { TableOverview } from '@prost/shared-types';
import { IconButton, Toast } from '@prost/ui';
import { useDropTable, useTruncateTable } from '../api/ddl';
import { useEngineDescriptor } from '../api/databaseEngines';
import { useSchemaOverview } from '../api/metadata';
import { useConfirm } from '../hooks/useConfirm';
import { useToasts } from '../hooks/useToasts';
import { apiErrorDetail } from '../lib/apiClient';
import { useWorkspaceStore } from '../stores/workspaceStore';

export interface DatabaseOverviewProps {
  connectionId: string;
  schema: string;
  /** Read-only connections (the app DB) hide destructive actions. */
  writable?: boolean;
}

/** Formats a byte count into a compact human string; `null` renders as an em dash. */
function formatBytes(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || Number.isInteger(value) ? 0 : 1)} ${units[unit]}`;
}

function formatRows(rows: number | null): string {
  return rows === null ? '—' : `~${rows.toLocaleString()}`;
}

export function DatabaseOverview({ connectionId, schema, writable = true }: DatabaseOverviewProps) {
  const { data, isLoading, isError } = useSchemaOverview(connectionId, schema);
  const descriptor = useEngineDescriptor(connectionId);
  const namespaceLabel = descriptor?.namespaceLabel ?? 'Schema';

  const openTable = useWorkspaceStore((state) => state.openTable);
  const closeTableTab = useWorkspaceStore((state) => state.closeTableTab);

  const dropTable = useDropTable(connectionId);
  const truncateTable = useTruncateTable(connectionId);
  const { confirm, dialog: confirmDialog } = useConfirm();
  const { toasts, push: pushToast, dismiss: dismissToast } = useToasts();

  async function handleEmpty(name: string) {
    const ok = await confirm({
      title: `Empty "${name}"?`,
      description: `Delete every row in ${schema}.${name}. This cannot be undone.`,
      confirmLabel: 'Empty table',
      danger: true,
    });
    if (!ok) return;
    truncateTable.mutate(
      { schema, table: name },
      { onError: (error) => pushToast('danger', apiErrorDetail(error, 'Failed to empty table.')) },
    );
  }

  async function handleDrop(name: string) {
    const ok = await confirm({
      title: `Drop "${name}"?`,
      description: `DROP TABLE ${schema}.${name} — the table and all its data are permanently removed.`,
      confirmLabel: 'Drop table',
      danger: true,
    });
    if (!ok) return;
    dropTable.mutate(
      { schema, table: name },
      {
        onSuccess: () => closeTableTab(schema, name),
        onError: (error) => pushToast('danger', apiErrorDetail(error, 'Failed to drop table.')),
      },
    );
  }

  if (isLoading) {
    return <p className="px-lg py-md text-sm text-text-faint">Loading overview…</p>;
  }
  if (isError) {
    return <p className="px-lg py-md text-sm text-danger">Failed to load {namespaceLabel.toLowerCase()} overview.</p>;
  }
  if (!data) return null;

  const cell = 'px-md py-sm whitespace-nowrap';
  const num = `${cell} text-right tabular-nums`;

  return (
    <>
      {confirmDialog}
      <div className="h-full space-y-md overflow-auto p-lg">
        <header className="flex flex-wrap items-baseline gap-x-md gap-y-xs">
          <h2 className="flex items-center gap-sm text-sm font-medium text-text">
            <Table2 size={15} className="text-accent" />
            {namespaceLabel}: <span className="font-mono">{schema}</span>
          </h2>
          <span className="text-xs text-text-faint">
            {data.tables.length} {data.tables.length === 1 ? 'table' : 'tables'}
            {data.totalRowEstimate !== null ? ` · ${formatRows(data.totalRowEstimate)} rows` : ''}
            {data.totalSizeBytes !== null ? ` · ${formatBytes(data.totalSizeBytes)}` : ''}
          </span>
        </header>

        {data.tables.length === 0 ? (
          <p className="text-sm italic text-text-faint">No tables in this {namespaceLabel.toLowerCase()}.</p>
        ) : (
          <div className="overflow-hidden rounded-md border border-border">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-sunken text-xs uppercase tracking-wider text-text-faint">
                  <th className={`${cell} text-left font-medium`}>Table</th>
                  <th className={`${num} font-medium`}>Rows</th>
                  <th className={`${num} font-medium`}>Size</th>
                  <th className={`${num} font-medium`}>Cols</th>
                  <th className={`${num} font-medium`}>Indexes</th>
                  <th className={`${cell} text-left font-medium`}>Engine</th>
                  <th className={`${cell} text-left font-medium`}>Collation</th>
                  <th className={`${cell} text-right font-medium`}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.tables.map((table: TableOverview, i) => (
                  <tr
                    key={table.name}
                    className={i < data.tables.length - 1 ? 'border-b border-border' : undefined}
                    title={table.comment ?? undefined}
                  >
                    <td className={`${cell} text-left`}>
                      <button
                        type="button"
                        onClick={() => openTable(schema, table.name, 'rows')}
                        className="font-medium text-accent hover:underline"
                      >
                        {table.name}
                      </button>
                    </td>
                    <td className={num}>{formatRows(table.rowEstimate)}</td>
                    <td className={num}>{formatBytes(table.sizeBytes)}</td>
                    <td className={num}>{table.columnCount}</td>
                    <td className={num}>{table.indexCount}</td>
                    <td className={`${cell} text-left text-text-muted`}>{table.engine ?? '—'}</td>
                    <td className={`${cell} text-left text-text-muted`}>{table.collation ?? '—'}</td>
                    <td className={`${cell} text-right`}>
                      <div className="flex items-center justify-end gap-xs">
                        <IconButton
                          aria-label={`Browse rows of ${table.name}`}
                          title="Browse rows"
                          onClick={() => openTable(schema, table.name, 'rows')}
                        >
                          <Rows3 size={14} />
                        </IconButton>
                        <IconButton
                          aria-label={`View structure of ${table.name}`}
                          title="View structure"
                          onClick={() => openTable(schema, table.name, 'structure')}
                        >
                          <StretchHorizontal size={14} />
                        </IconButton>
                        <IconButton
                          aria-label={`Search ${table.name}`}
                          title="Search all columns"
                          onClick={() => openTable(schema, table.name, 'rows', { search: '' })}
                        >
                          <Search size={14} />
                        </IconButton>
                        {writable ? (
                          <>
                            <IconButton
                              aria-label={`Empty ${table.name}`}
                              title="Empty table"
                              onClick={() => void handleEmpty(table.name)}
                              disabled={truncateTable.isPending}
                            >
                              <Eraser size={14} />
                            </IconButton>
                            <IconButton
                              aria-label={`Drop ${table.name}`}
                              title="Drop table"
                              onClick={() => void handleDrop(table.name)}
                              disabled={dropTable.isPending}
                            >
                              <Trash2 size={14} />
                            </IconButton>
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
    </>
  );
}
