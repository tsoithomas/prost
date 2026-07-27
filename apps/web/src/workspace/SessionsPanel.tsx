import { useMemo, useState } from 'react';
import { Ban, ChevronDown, ChevronUp, RefreshCw, XCircle } from 'lucide-react';
import clsx from 'clsx';
import type { DbSession, KillSessionMode } from '@prost/shared-types';
import { Badge, Button, Checkbox, Toast } from '@prost/ui';
import { useKillSession, useSessions } from '../api/sessions';
import { useConfirm } from '../hooks/useConfirm';
import { useToasts } from '../hooks/useToasts';
import { apiErrorDetail } from '../lib/apiClient';

const AUTO_REFRESH_MS = 5000;
const WARN_MS = 30_000;
const DANGER_MS = 300_000;

type SortKey = 'id' | 'user' | 'database' | 'state' | 'durationMs';

function formatDuration(ms?: number): string {
  if (ms === undefined) return '—';
  if (ms < 1000) return `${ms} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds % 60)}s`;
}

function durationClass(ms?: number): string {
  if (ms === undefined) return 'text-text-faint';
  if (ms >= DANGER_MS) return 'text-danger';
  if (ms >= WARN_MS) return 'text-warning';
  return 'text-text-muted';
}

function sortSessions(sessions: DbSession[], key: SortKey, dir: 'asc' | 'desc'): DbSession[] {
  const factor = dir === 'asc' ? 1 : -1;
  return [...sessions].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (av === undefined) return 1;
    if (bv === undefined) return -1;
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * factor;
    return String(av).localeCompare(String(bv)) * factor;
  });
}

export interface SessionsPanelProps {
  connectionId: string;
  /** Read-only connections can monitor but not kill (Phase 25). */
  writable?: boolean;
}

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'id', label: 'PID' },
  { key: 'user', label: 'User' },
  { key: 'database', label: 'Database' },
  { key: 'state', label: 'State' },
  { key: 'durationMs', label: 'Duration' },
];

export function SessionsPanel({ connectionId, writable = true }: SessionsPanelProps) {
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'durationMs', dir: 'desc' });
  const { data, isLoading, isError, refetch, isFetching } = useSessions(connectionId, {
    refetchInterval: autoRefresh ? AUTO_REFRESH_MS : false,
  });
  const killSession = useKillSession(connectionId);
  const { confirm, dialog: confirmDialog } = useConfirm();
  const { toasts, push: pushToast, dismiss: dismissToast } = useToasts();

  const sessions = useMemo(() => sortSessions(data ?? [], sort.key, sort.dir), [data, sort]);

  function toggleSort(key: SortKey) {
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  }

  async function handleKill(session: DbSession, mode: KillSessionMode) {
    const verb = mode === 'terminate' ? 'Terminate' : 'Cancel';
    const confirmed = await confirm({
      title: `${verb} session ${session.id}?`,
      description:
        mode === 'terminate'
          ? 'Force-close this connection. Any in-progress transaction is rolled back.'
          : 'Cancel the query currently running in this session.',
      confirmLabel: verb,
      danger: mode === 'terminate',
    });
    if (!confirmed) return;
    killSession.mutate(
      { sessionId: session.id, mode },
      { onError: (error) => pushToast('danger', apiErrorDetail(error, `Failed to ${verb.toLowerCase()} session.`)) },
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-sm border-b border-border bg-surface px-sm py-1.5 text-xs">
        <span className="font-medium text-text">Active sessions</span>
        <span className="text-text-faint">{sessions.length}</span>
        <Button variant="secondary" size="sm" onClick={() => void refetch()} disabled={isFetching} className="ml-auto">
          <RefreshCw size={12} className={clsx(isFetching && 'animate-spin')} />
          Refresh
        </Button>
        <label className="flex items-center gap-xs text-text-faint" title="Refresh automatically every 5 seconds">
          <Checkbox checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} aria-label="Auto-refresh" />
          Auto
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {isLoading ? (
          <p className="px-sm py-3 text-xs italic text-text-faint">Loading sessions…</p>
        ) : isError ? (
          <p className="px-sm py-3 text-xs text-danger">Failed to load sessions.</p>
        ) : sessions.length === 0 ? (
          <p className="px-sm py-3 text-xs italic text-text-faint">No active sessions.</p>
        ) : (
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 bg-surface-sunken text-text-faint">
              <tr>
                {COLUMNS.map((col) => (
                  <th key={col.key} className="border-b border-border px-2 py-1 text-left font-medium">
                    <button type="button" onClick={() => toggleSort(col.key)} className="inline-flex items-center gap-0.5 hover:text-text">
                      {col.label}
                      {sort.key === col.key ? (sort.dir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />) : null}
                    </button>
                  </th>
                ))}
                <th className="border-b border-border px-2 py-1 text-left font-medium">Query</th>
                <th className="border-b border-border px-2 py-1 text-left font-medium">Blocked by</th>
                <th className="border-b border-border px-2 py-1 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => (
                <tr key={String(session.id)} className="border-b border-border/60 align-top hover:bg-surface-hover">
                  <td className="px-2 py-1 font-mono">{session.id}</td>
                  <td className="px-2 py-1 text-text-muted">{session.user ?? '—'}</td>
                  <td className="px-2 py-1 text-text-muted">{session.database ?? '—'}</td>
                  <td className="px-2 py-1 text-text-muted">{session.state ?? '—'}</td>
                  <td className={clsx('px-2 py-1 whitespace-nowrap font-medium', durationClass(session.durationMs))}>
                    {formatDuration(session.durationMs)}
                  </td>
                  <td className="max-w-[24rem] px-2 py-1">
                    <span className="line-clamp-2 font-mono text-text" title={session.query}>
                      {session.query || '—'}
                    </span>
                  </td>
                  <td className="px-2 py-1">
                    {session.blockedBy && session.blockedBy.length > 0 ? (
                      <Badge variant="danger">{session.blockedBy.join(', ')}</Badge>
                    ) : (
                      <span className="text-text-faint">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1 text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleKill(session, 'cancel')}
                        disabled={!writable || killSession.isPending}
                        title={writable ? 'Cancel the running query' : 'This connection is read-only'}
                      >
                        <Ban size={12} />
                        Cancel
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleKill(session, 'terminate')}
                        disabled={!writable || killSession.isPending}
                        title={writable ? 'Terminate the session' : 'This connection is read-only'}
                        className="!text-danger"
                      >
                        <XCircle size={12} />
                        Terminate
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {confirmDialog}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-sm p-md sm:items-end">
        {toasts.map((toast) => (
          <div key={toast.id} className="pointer-events-auto w-full max-w-[24rem]">
            <Toast variant={toast.variant} message={toast.message} onDismiss={() => dismissToast(toast.id)} />
          </div>
        ))}
      </div>
    </div>
  );
}
