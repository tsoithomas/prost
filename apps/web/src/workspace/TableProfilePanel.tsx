import { useState } from 'react';
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import type { ColumnProfile, ProfileSampleKind } from '@prost/shared-types';
import { Badge, Button, IconButton } from '@prost/ui';
import { ColumnTypePill } from '../grid/columnDefs';
import { useColumnTopValues, useTableProfile } from '../api/metadata';

export interface TableProfilePanelProps {
  connectionId: string;
  schema: string;
  table: string;
}

/** How the numbers were obtained, said plainly — a sampled figure must never read as exact. */
const SAMPLE_LABEL: Record<ProfileSampleKind, string> = {
  full: 'Full scan',
  random: 'Random sample',
  firstRows: 'First rows only',
};

function formatCount(value: number | null): string {
  return value === null ? '—' : value.toLocaleString();
}

function formatPercent(fraction: number): string {
  const percent = fraction * 100;
  if (percent === 0) return '0%';
  if (percent < 1) return '<1%';
  return `${Math.round(percent)}%`;
}

/** Truncated for display; the full value stays available as a tooltip. */
function preview(value: string | null): string {
  if (value === null) return '∅ null';
  if (value === '') return '(empty)';
  return value.length > 40 ? `${value.slice(0, 40)}…` : value;
}

/**
 * On-demand data profile of a table (Phase 37): per-column null share, distinct count, and range,
 * with a lazily-loaded top-N distribution per column. Pure read — it works on read-only and `prod`
 * connections, and offers no write affordance.
 */
export function TableProfilePanel({ connectionId, schema, table }: TableProfilePanelProps) {
  const [exact, setExact] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data, isLoading, isError, isFetching, refetch } = useTableProfile(connectionId, schema, table, exact);

  if (isLoading) {
    return <p className="px-lg py-md text-sm text-text-faint">Profiling {table}…</p>;
  }
  if (isError) {
    return (
      <p className="px-lg py-md text-sm text-danger">
        Failed to profile this table. Very large tables can exceed the statement timeout — try again, or
        keep sampling on.
      </p>
    );
  }
  if (!data) return null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-sm border-b border-border bg-surface px-sm py-1.5 text-xs text-text-faint">
        <span className="font-medium text-text">{data.columns.length} columns</span>
        <span>
          {data.scannedRows.toLocaleString()} rows scanned
          {data.totalRows !== null && data.totalRows !== data.scannedRows
            ? ` of ${data.exact ? '' : '~'}${data.totalRows.toLocaleString()}`
            : ''}
        </span>
        <Badge variant={data.sample === 'full' ? 'neutral' : 'warning'}>{SAMPLE_LABEL[data.sample]}</Badge>
        {data.columnsOmitted > 0 ? (
          <Badge variant="neutral">{data.columnsOmitted} columns not profiled</Badge>
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" aria-pressed={exact} onClick={() => setExact((value) => !value)}>
            {exact ? 'Estimated' : 'Exact count'}
          </Button>
          <IconButton aria-label="Re-run profile" title="Re-run profile" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw size={13} className={isFetching ? 'animate-spin' : undefined} />
          </IconButton>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-lg">
        {data.columns.length === 0 ? (
          <p className="text-sm italic text-text-faint">This table has no columns to profile.</p>
        ) : (
          <div className="overflow-hidden rounded-md border border-border">
            {data.columns.map((column, i) => (
              <ProfileRow
                key={column.column}
                connectionId={connectionId}
                schema={schema}
                table={table}
                column={column}
                exact={exact}
                scannedRows={data.scannedRows}
                expanded={expanded === column.column}
                onToggle={() => setExpanded((current) => (current === column.column ? null : column.column))}
                last={i === data.columns.length - 1}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface ProfileRowProps {
  connectionId: string;
  schema: string;
  table: string;
  column: ColumnProfile;
  exact: boolean;
  scannedRows: number;
  expanded: boolean;
  onToggle: () => void;
  last: boolean;
}

function ProfileRow({ connectionId, schema, table, column, exact, scannedRows, expanded, onToggle, last }: ProfileRowProps) {
  const distinctFraction = scannedRows > 0 && column.distinctCount !== null ? column.distinctCount / scannedRows : 0;

  return (
    <div className={clsx(!last && 'border-b border-border')}>
      <button
        type="button"
        onClick={column.comparable ? onToggle : undefined}
        aria-expanded={column.comparable ? expanded : undefined}
        disabled={!column.comparable}
        className={clsx(
          'flex w-full items-center gap-sm px-md py-sm text-left text-sm transition-colors',
          column.comparable ? 'hover:bg-surface-hover' : 'cursor-default',
        )}
      >
        <span className="w-3 shrink-0 text-text-faint">
          {column.comparable ? (
            expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />
          ) : null}
        </span>
        <span className="min-w-0 flex-1 truncate font-medium text-text">{column.column}</span>
        <ColumnTypePill dataType={column.dataType} />

        <span className="flex w-28 shrink-0 items-center gap-xs max-md:hidden" title={`${column.nullCount.toLocaleString()} null values`}>
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-sunken">
            <span
              className="block h-full bg-warning"
              style={{ width: `${Math.min(100, column.nullFraction * 100)}%` }}
            />
          </span>
          <span className="w-9 text-right tabular-nums text-xs text-text-muted">{formatPercent(column.nullFraction)}</span>
        </span>

        <span className="w-24 shrink-0 text-right tabular-nums text-xs text-text-muted" title="Distinct values">
          {formatCount(column.distinctCount)}
          {column.distinctCount !== null && distinctFraction >= 0.99 ? ' ·uniq' : ''}
        </span>

        <span
          className="w-48 shrink-0 truncate text-right font-mono text-xs text-text-faint max-md:hidden"
          title={column.min !== null || column.max !== null ? `${column.min} … ${column.max}` : undefined}
        >
          {column.min === null && column.max === null ? '—' : `${preview(column.min)} … ${preview(column.max)}`}
        </span>
      </button>

      {expanded ? (
        <TopValues connectionId={connectionId} schema={schema} table={table} column={column.column} exact={exact} />
      ) : null}
    </div>
  );
}

interface TopValuesProps {
  connectionId: string;
  schema: string;
  table: string;
  column: string;
  exact: boolean;
}

/** The column's most common values — only mounted (and therefore only fetched) once expanded. */
function TopValues({ connectionId, schema, table, column, exact }: TopValuesProps) {
  const { data, isLoading, isError } = useColumnTopValues(connectionId, schema, table, column, exact);

  if (isLoading) return <p className="px-md pb-sm pl-8 text-xs text-text-faint">Loading values…</p>;
  if (isError) return <p className="px-md pb-sm pl-8 text-xs text-danger">Failed to load values.</p>;
  if (!data || data.values.length === 0) {
    return <p className="px-md pb-sm pl-8 text-xs italic text-text-faint">No values.</p>;
  }

  return (
    <ul className="space-y-0.5 px-md pb-sm pl-8">
      {data.values.map((share) => (
        <li key={share.value ?? ' null'} className="flex items-center gap-sm text-xs">
          <span
            className={clsx('w-48 shrink-0 truncate font-mono', share.value === null ? 'italic text-text-faint' : 'text-text')}
            title={share.value ?? 'null'}
          >
            {preview(share.value)}
          </span>
          <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-sunken">
            <span className="block h-full bg-accent" style={{ width: `${Math.min(100, share.fraction * 100)}%` }} />
          </span>
          <span className="w-20 shrink-0 text-right tabular-nums text-text-muted">
            {share.count.toLocaleString()} · {formatPercent(share.fraction)}
          </span>
        </li>
      ))}
    </ul>
  );
}
