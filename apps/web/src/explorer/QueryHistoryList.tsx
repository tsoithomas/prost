import { useState } from 'react';
import { Download, Pencil, Star, Trash2, X } from 'lucide-react';
import clsx from 'clsx';
import type { QueryHistoryDto } from '@prost/shared-types';
import { Checkbox, IconButton, Input, Surface } from '@prost/ui';
import {
  useClearHistory,
  useDeleteHistory,
  useHistoryExport,
  useHistorySearch,
  useUpdateHistory,
} from '../api/history';
import { useConfirm } from '../hooks/useConfirm';
import { formatRelativeTime } from '../lib/formatRelativeTime';

export interface QueryHistoryListProps {
  /** The active connection; the per-connection view scopes to it. `null` = no active connection. */
  connectionId: string | null;
  /** Click-to-load — stages the SQL into the active query tab (no auto-run). */
  onSelect: (sql: string) => void;
}

/**
 * Connected recent-queries list shared by the desktop Sidebar and mobile Settings. Supports search,
 * a cross-connection "All connections" view, per-entry star/rename/delete, export, and clear — all
 * server-side and ownership-scoped (Phase 19). Mirrors the Phase 13 SnippetList interaction patterns.
 */
export function QueryHistoryList({ connectionId, onSelect }: QueryHistoryListProps) {
  const [search, setSearch] = useState('');
  const [allConnections, setAllConnections] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const effectiveConnectionId = allConnections ? null : connectionId;
  const canQuery = allConnections || connectionId !== null;
  const { data: items, isLoading, isError } = useHistorySearch({
    connectionId: effectiveConnectionId,
    search,
    enabled: canQuery,
  });
  const updateHistory = useUpdateHistory();
  const deleteHistory = useDeleteHistory();
  const clearHistory = useClearHistory();
  const exportHistory = useHistoryExport();
  const { confirm, dialog: confirmDialog } = useConfirm();

  function toggleStar(entry: QueryHistoryDto) {
    updateHistory.mutate({ id: entry.id, starred: !entry.starred });
  }

  function startRename(entry: QueryHistoryDto) {
    setRenamingId(entry.id);
    setRenameValue(entry.label ?? '');
  }

  function submitRename(id: string) {
    updateHistory.mutate(
      { id, label: renameValue.trim() || null },
      { onSuccess: () => setRenamingId(null) },
    );
  }

  async function handleDelete(entry: QueryHistoryDto) {
    const confirmed = await confirm({
      title: 'Delete history entry',
      description: 'Remove this query from your history? This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!confirmed) return;
    deleteHistory.mutate(entry.id);
  }

  async function handleClear() {
    const scope = allConnections ? 'all connections' : 'this connection';
    const confirmed = await confirm({
      title: 'Clear history',
      description: `Remove all non-starred history for ${scope}? Starred entries are kept. This cannot be undone.`,
      confirmLabel: 'Clear',
      danger: true,
    });
    if (!confirmed) return;
    clearHistory.mutate(effectiveConnectionId);
  }

  return (
    <div className="flex flex-col gap-sm">
      <div className="flex items-center gap-xs">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search history…"
          className="h-7 flex-1 text-xs"
        />
        <IconButton
          aria-label="Export history"
          title="Export history"
          onClick={() => exportHistory.mutate()}
        >
          <Download size={14} />
        </IconButton>
        <IconButton aria-label="Clear history" title="Clear history" onClick={handleClear}>
          <Trash2 size={14} />
        </IconButton>
      </div>

      <label className="flex cursor-pointer items-center gap-xs px-sm text-xs text-text-muted">
        <Checkbox checked={allConnections} onChange={(e) => setAllConnections(e.target.checked)} />
        All connections
      </label>

      <HistoryEntries
        items={items}
        isLoading={isLoading}
        isError={isError}
        canQuery={canQuery}
        showConnection={allConnections}
        renamingId={renamingId}
        renameValue={renameValue}
        onSelect={onSelect}
        onToggleStar={toggleStar}
        onStartRename={startRename}
        onRenameChange={setRenameValue}
        onSubmitRename={submitRename}
        onCancelRename={() => setRenamingId(null)}
        onDelete={handleDelete}
      />
      {confirmDialog}
    </div>
  );
}

interface HistoryEntriesProps {
  items: QueryHistoryDto[] | undefined;
  isLoading: boolean;
  isError: boolean;
  canQuery: boolean;
  showConnection: boolean;
  renamingId: string | null;
  renameValue: string;
  onSelect: (sql: string) => void;
  onToggleStar: (entry: QueryHistoryDto) => void;
  onStartRename: (entry: QueryHistoryDto) => void;
  onRenameChange: (value: string) => void;
  onSubmitRename: (id: string) => void;
  onCancelRename: () => void;
  onDelete: (entry: QueryHistoryDto) => void;
}

function HistoryEntries({
  items,
  isLoading,
  isError,
  canQuery,
  showConnection,
  renamingId,
  renameValue,
  onSelect,
  onToggleStar,
  onStartRename,
  onRenameChange,
  onSubmitRename,
  onCancelRename,
  onDelete,
}: HistoryEntriesProps) {
  if (!canQuery) {
    return (
      <p className="px-sm py-2 text-xs italic text-text-faint">
        No active connection. Enable "All connections" to view your history.
      </p>
    );
  }

  if (isLoading) {
    return <p className="px-sm py-2 text-xs italic text-text-faint">Loading history…</p>;
  }

  if (isError) {
    return <p className="px-sm py-2 text-xs text-danger">Failed to load query history.</p>;
  }

  if (!items || items.length === 0) {
    return <p className="px-sm py-2 text-xs italic text-text-faint">No matching queries.</p>;
  }

  return (
    <Surface level="raised" bordered className="flex flex-col overflow-hidden rounded-md">
      {items.map((entry) => (
        <div
          key={entry.id}
          className="group flex items-start gap-sm border-b border-border px-md py-sm last:border-b-0"
        >
          <IconButton
            aria-label={entry.starred ? `Unstar query` : `Star query`}
            className="mt-0.5 shrink-0"
            onClick={() => onToggleStar(entry)}
          >
            <Star
              size={14}
              className={clsx(entry.starred ? 'fill-accent text-accent' : 'text-text-faint')}
            />
          </IconButton>
          <div className="flex min-w-0 flex-1 flex-col">
            {renamingId === entry.id ? (
              <div className="flex items-center gap-xs">
                <Input
                  value={renameValue}
                  onChange={(e) => onRenameChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onSubmitRename(entry.id);
                    if (e.key === 'Escape') onCancelRename();
                  }}
                  placeholder="Label (blank to clear)"
                  className="h-6 text-xs"
                  autoFocus
                />
                <IconButton aria-label="Cancel rename" onClick={onCancelRename}>
                  <X size={12} />
                </IconButton>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => onSelect(entry.sql)}
                className="flex flex-col text-left"
                title={entry.sql}
              >
                {entry.label ? (
                  <span className="truncate text-xs font-medium text-text hover:text-accent">{entry.label}</span>
                ) : null}
                <span
                  className={clsx(
                    'truncate font-mono text-xs',
                    entry.label ? 'text-text-faint' : 'text-text hover:text-accent',
                  )}
                >
                  {entry.sql}
                </span>
                <span className="text-xs text-text-faint">
                  {formatRelativeTime(entry.executedAt)}
                  {showConnection ? ` · ${entry.connectionName}` : ''}
                </span>
              </button>
            )}
          </div>
          {renamingId !== entry.id ? (
            <div className="flex shrink-0 gap-xs opacity-0 transition-opacity group-hover:opacity-100">
              <IconButton aria-label="Rename query" onClick={() => onStartRename(entry)}>
                <Pencil size={12} />
              </IconButton>
              <IconButton aria-label="Delete query" onClick={() => onDelete(entry)}>
                <Trash2 size={12} />
              </IconButton>
            </div>
          ) : null}
        </div>
      ))}
    </Surface>
  );
}
