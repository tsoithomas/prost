import { useEffect, useMemo, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import type { AuditAction, AuditEntryDto, AuditOutcome } from '@prost/shared-types';
import { AUDIT_ACTIONS, AUDIT_OUTCOMES } from '@prost/shared-types';
import { Badge, Button } from '@prost/ui';
import { useAuditExport, useAuditList, type AuditFilters } from '../api/audit';
import { useConnections } from '../api/connections';
import { useWorkspaceStore } from '../stores/workspaceStore';

const ACTION_VARIANT: Record<AuditAction, 'neutral' | 'accent' | 'warning' | 'danger'> = {
  insert: 'accent',
  update: 'accent',
  delete: 'danger',
  ddl: 'warning',
  truncate: 'danger',
  import: 'neutral',
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

function target(entry: AuditEntryDto): string {
  if (entry.targetSchema && entry.targetTable) return `${entry.targetSchema}.${entry.targetTable}`;
  return entry.targetTable ?? entry.targetSchema ?? '—';
}

const selectCls =
  'h-7 rounded-sm border border-border bg-surface px-sm text-xs text-text focus:border-accent focus:outline-none';

export function AuditPanel() {
  const auditTab = useWorkspaceStore((state) => state.tabs.find((tab) => tab.kind === 'audit'));
  const clearAuditPreset = useWorkspaceStore((state) => state.clearAuditPreset);
  const presetConnectionId = auditTab?.presetConnectionId;
  const [filters, setFilters] = useState<AuditFilters>(
    presetConnectionId ? { connectionId: presetConnectionId } : {},
  );
  const { data: connections = [] } = useConnections();

  // A per-connection breadcrumb launch seeds (or re-seeds, if the tab is already open) the connection
  // filter. One-shot: consume the preset so manual filter changes aren't overridden on re-render.
  useEffect(() => {
    if (!auditTab) return;
    if (presetConnectionId !== undefined) {
      setFilters((prev) => ({ ...prev, connectionId: presetConnectionId }));
      clearAuditPreset(auditTab.id);
    }
  }, [auditTab, presetConnectionId, clearAuditPreset]);
  const { data, isLoading, isError, refetch, isFetching, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useAuditList(filters);
  const auditExport = useAuditExport(filters);

  const entries = useMemo(() => data?.pages.flatMap((page) => page.entries) ?? [], [data]);

  function patchFilter(patch: Partial<AuditFilters>) {
    setFilters((prev) => {
      const next = { ...prev, ...patch };
      // Drop empty-string keys so they don't reach the query string.
      for (const key of Object.keys(next) as (keyof AuditFilters)[]) {
        if (!next[key]) delete next[key];
      }
      return next;
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-sm border-b border-border bg-surface px-sm py-1.5 text-xs">
        <span className="font-medium text-text">Audit log</span>

        <select
          aria-label="Filter by connection"
          className={selectCls}
          value={filters.connectionId ?? ''}
          onChange={(e) => patchFilter({ connectionId: e.target.value || undefined })}
        >
          <option value="">All connections</option>
          {connections.map((connection) => (
            <option key={connection.id} value={connection.id}>
              {connection.name}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter by action"
          className={selectCls}
          value={filters.action ?? ''}
          onChange={(e) => patchFilter({ action: (e.target.value || undefined) as AuditAction | undefined })}
        >
          <option value="">All actions</option>
          {AUDIT_ACTIONS.map((action) => (
            <option key={action} value={action}>
              {action}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter by outcome"
          className={selectCls}
          value={filters.outcome ?? ''}
          onChange={(e) => patchFilter({ outcome: (e.target.value || undefined) as AuditOutcome | undefined })}
        >
          <option value="">Any outcome</option>
          {AUDIT_OUTCOMES.map((outcome) => (
            <option key={outcome} value={outcome}>
              {outcome}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-xs text-text-faint">
          From
          <input
            type="date"
            aria-label="From date"
            className={selectCls}
            value={filters.from ?? ''}
            onChange={(e) => patchFilter({ from: e.target.value || undefined })}
          />
        </label>
        <label className="flex items-center gap-xs text-text-faint">
          To
          <input
            type="date"
            aria-label="To date"
            className={selectCls}
            value={filters.to ?? ''}
            onChange={(e) => patchFilter({ to: e.target.value || undefined })}
          />
        </label>

        <Button variant="secondary" size="sm" onClick={() => void refetch()} disabled={isFetching} className="ml-auto">
          <RefreshCw size={12} className={clsx(isFetching && 'animate-spin')} />
          Refresh
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => auditExport.mutate()}
          disabled={auditExport.isPending || entries.length === 0}
          title="Export the filtered audit log as JSON"
        >
          <Download size={12} />
          Export
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {isLoading ? (
          <p className="px-sm py-3 text-xs italic text-text-faint">Loading audit log…</p>
        ) : isError ? (
          <p className="px-sm py-3 text-xs text-danger">Failed to load audit log.</p>
        ) : entries.length === 0 ? (
          <p className="px-sm py-3 text-xs italic text-text-faint">No audit entries match these filters.</p>
        ) : (
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 bg-surface-sunken text-text-faint">
              <tr>
                <th className="border-b border-border px-2 py-1 text-left font-medium">Action</th>
                <th className="border-b border-border px-2 py-1 text-left font-medium">Outcome</th>
                <th className="border-b border-border px-2 py-1 text-left font-medium">Target</th>
                <th className="border-b border-border px-2 py-1 text-left font-medium">Statement</th>
                <th className="border-b border-border px-2 py-1 text-right font-medium">Duration</th>
                <th className="border-b border-border px-2 py-1 text-left font-medium">Connection</th>
                <th className="border-b border-border px-2 py-1 text-left font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const failed = entry.outcome === 'failure';
                return (
                  <tr
                    key={entry.id}
                    className={clsx(
                      'border-b border-border/60 align-top hover:bg-surface-hover',
                      failed && 'bg-danger/5',
                    )}
                  >
                    <td className="px-2 py-1">
                      <Badge variant={ACTION_VARIANT[entry.action]}>{entry.action}</Badge>
                    </td>
                    <td className="px-2 py-1">
                      <Badge variant={failed ? 'danger' : 'success'}>{entry.outcome}</Badge>
                      {failed && entry.errorClass ? (
                        <span className="ml-1 font-mono text-danger" title="Error class">
                          {entry.errorClass}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-2 py-1 font-mono text-text-muted">{target(entry)}</td>
                    <td className="max-w-[28rem] px-2 py-1">
                      <span className="line-clamp-2 font-mono text-text" title={entry.sql}>
                        {entry.sql}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-2 py-1 text-right font-medium text-text-muted">
                      {formatDuration(entry.durationMs)}
                    </td>
                    <td className="px-2 py-1 text-text-muted">
                      {entry.connectionName ?? <span className="italic text-text-faint">deleted</span>}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1 text-text-faint">{formatTimestamp(entry.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {hasNextPage ? (
          <div className="flex justify-center p-sm">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void fetchNextPage()}
              disabled={isFetchingNextPage}
            >
              {isFetchingNextPage ? 'Loading…' : 'Load more'}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
