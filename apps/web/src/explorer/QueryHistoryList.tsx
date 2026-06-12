import { History } from 'lucide-react';
import type { QueryHistoryDto } from '@prost/shared-types';
import { Surface } from '@prost/ui';
import { formatRelativeTime } from '../lib/formatRelativeTime';

export interface QueryHistoryListProps {
  items: QueryHistoryDto[] | undefined;
  isLoading: boolean;
  isError: boolean;
  onSelect: (sql: string) => void;
}

/** Read-only recent-queries list shared by the desktop Sidebar and mobile Settings views. */
export function QueryHistoryList({ items, isLoading, isError, onSelect }: QueryHistoryListProps) {
  if (isLoading) {
    return <p className="px-sm py-2 text-xs italic text-text-faint">Loading history…</p>;
  }

  if (isError) {
    return <p className="px-sm py-2 text-xs text-danger">Failed to load query history.</p>;
  }

  if (!items || items.length === 0) {
    return <p className="px-sm py-2 text-xs italic text-text-faint">Query history will appear here.</p>;
  }

  return (
    <Surface level="raised" bordered className="flex flex-col overflow-hidden rounded-md">
      {items.map((entry) => (
        <button
          key={entry.id}
          type="button"
          onClick={() => onSelect(entry.sql)}
          className="flex items-start gap-sm border-b border-border px-md py-sm text-left last:border-b-0 hover:bg-surface-hover"
        >
          <History size={14} className="mt-0.5 shrink-0 text-text-faint" />
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-mono text-xs text-text" title={entry.sql}>
              {entry.sql}
            </span>
            <span className="text-xs text-text-faint">{formatRelativeTime(entry.executedAt)}</span>
          </div>
        </button>
      ))}
    </Surface>
  );
}
