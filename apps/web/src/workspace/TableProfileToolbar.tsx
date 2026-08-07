import { RefreshCw } from 'lucide-react';
import type { ProfileSampleKind } from '@prost/shared-types';
import { Badge, Button, IconButton, Tooltip } from '@prost/ui';
import { useTableProfile } from '../api/metadata';

export interface TableProfileToolbarProps {
  connectionId: string;
  schema: string;
  table: string;
  /** Owned by `TableView` — the rows below scope their top-value reads to the same setting. */
  exact: boolean;
  onToggleExact: () => void;
}

/** How the numbers were obtained, said plainly — a sampled figure must never read as exact. */
export const SAMPLE_LABEL: Record<ProfileSampleKind, string> = {
  full: 'Full scan',
  random: 'Random sample',
  firstRows: 'First rows only',
};

/**
 * The Profile view's slice of `TableView`'s toolbar: what was scanned, and the controls that change
 * it. Shares `useTableProfile`'s query key with `TableProfilePanel`, so both read one cached result
 * and `refetch` here re-runs the profile the panel is showing.
 */
export function TableProfileToolbar({ connectionId, schema, table, exact, onToggleExact }: TableProfileToolbarProps) {
  const { data, isFetching, refetch } = useTableProfile(connectionId, schema, table, exact);

  const scanned = data
    ? `${data.scannedRows.toLocaleString()} rows scanned${
        data.totalRows !== null && data.totalRows !== data.scannedRows
          ? ` of ${data.exact ? '' : '~'}${data.totalRows.toLocaleString()}`
          : ''
      }`
    : null;

  return (
    <>
      {data ? (
        <span className="px-sm text-xs text-text-faint">
          {data.columns.length} {data.columns.length === 1 ? 'column' : 'columns'} · {scanned}
        </span>
      ) : null}
      {data ? (
        <Badge variant={data.sample === 'full' ? 'neutral' : 'warning'}>{SAMPLE_LABEL[data.sample]}</Badge>
      ) : null}
      {data && data.columnsOmitted > 0 ? (
        <Badge variant="neutral">{data.columnsOmitted} columns not profiled</Badge>
      ) : null}
      <div className="mx-1 h-4 w-px bg-border" />
      <Button variant="ghost" size="sm" aria-pressed={exact} onClick={onToggleExact}>
        {exact ? 'Estimated' : 'Exact count'}
      </Button>
      <Tooltip content="Re-run profile">
        <IconButton aria-label="Re-run profile" onClick={() => void refetch()} disabled={isFetching}>
          <RefreshCw size={14} className={isFetching ? 'animate-spin' : undefined} />
        </IconButton>
      </Tooltip>
    </>
  );
}
