import { Fragment, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import type { StatementStat } from '@prost/shared-types';
import { Button, Tooltip } from '@prost/ui';
import { usePerformanceInsights } from '../api/performance';
import { useExplainQuery } from '../api/query';
import { SchemaSuggestionList } from '../ddl/SchemaSuggestionList';
import { useSchemaSuggestions } from '../ddl/useSchemaSuggestions';
import { apiErrorDetail } from '../lib/apiClient';

type SortKey = keyof Pick<StatementStat, 'query' | 'calls' | 'meanTimeMs' | 'totalTimeMs' | 'rows'>;

const COLUMNS: { key: SortKey; label: string; description: string; numeric?: boolean }[] = [
  {
    key: 'query',
    label: 'Statement',
    description: 'Normalized SQL; executions with different values are grouped.',
  },
  {
    key: 'calls',
    label: 'Calls',
    description: 'Executions since statement statistics were last reset.',
    numeric: true,
  },
  {
    key: 'meanTimeMs',
    label: 'Mean time',
    description: 'Average database execution time per call.',
    numeric: true,
  },
  {
    key: 'totalTimeMs',
    label: 'Total time',
    description: 'Combined database execution time across all recorded calls.',
    numeric: true,
  },
  {
    key: 'rows',
    label: 'Rows',
    description: 'Total rows returned or affected across all recorded calls.',
    numeric: true,
  },
];

function sortStatements(
  statements: StatementStat[],
  key: SortKey,
  direction: 'asc' | 'desc',
): StatementStat[] {
  const factor = direction === 'asc' ? 1 : -1;
  return [...statements].sort((a, b) => {
    if (key === 'query') return a.query.localeCompare(b.query) * factor;
    return (a[key] - b[key]) * factor;
  });
}

function formatCount(value: number): string {
  return Math.round(value).toLocaleString();
}

function formatDuration(value: number): string {
  if (value < 1) return `${value.toFixed(2)} ms`;
  if (value < 1_000) return `${value.toFixed(1)} ms`;
  if (value < 60_000) return `${(value / 1_000).toFixed(2)} s`;
  return `${(value / 60_000).toFixed(2)} min`;
}

function formatStatisticsSince(value: string): string | null {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export interface PerformancePanelProps {
  connectionId: string;
  writable?: boolean;
}

export function PerformancePanel({ connectionId, writable = true }: PerformancePanelProps) {
  const [sort, setSort] = useState<{ key: SortKey; direction: 'asc' | 'desc' }>({
    key: 'totalTimeMs',
    direction: 'desc',
  });
  const [activeQuery, setActiveQuery] = useState<string | null>(null);
  const [planUnavailable, setPlanUnavailable] = useState(false);
  const snapshotQuery = usePerformanceInsights(connectionId);
  const explain = useExplainQuery(connectionId);
  const advice = useSchemaSuggestions(connectionId);

  const statements = useMemo(
    () =>
      sortStatements(
        snapshotQuery.data?.status === 'available' ? snapshotQuery.data.statements : [],
        sort.key,
        sort.direction,
      ),
    [snapshotQuery.data, sort],
  );
  const advicePending = explain.isPending || advice.isPending;
  const statisticsWindow =
    snapshotQuery.data?.status === 'available' ? snapshotQuery.data.statisticsWindow : undefined;
  const statisticsSince = statisticsWindow
    ? formatStatisticsSince(statisticsWindow.since)
    : null;

  function toggleSort(key: SortKey) {
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: key === 'query' ? 'asc' : 'desc' },
    );
  }

  async function suggestIndexes(query: string) {
    if (advicePending) return;
    setActiveQuery(query);
    setPlanUnavailable(false);
    advice.reset();

    const requestWithoutPlan = () => advice.request({ sql: query, scope: 'indexes' });
    if (!advice.ready) {
      requestWithoutPlan();
      return;
    }

    try {
      const plan = await explain.mutateAsync({ sql: query, analyze: false });
      advice.request({ sql: query, plan, scope: 'indexes' });
    } catch {
      // Workload catalogs normalize literals into placeholders, so replay often cannot bind the
      // original values. Phase 33 can still ground index advice in normalized SQL + live metadata.
      setPlanUnavailable(true);
      requestWithoutPlan();
    }
  }

  function refresh() {
    setActiveQuery(null);
    setPlanUnavailable(false);
    advice.reset();
    void snapshotQuery.refetch();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-sm border-b border-border bg-surface px-sm py-1.5 text-xs">
        <span className="font-medium text-text">Top statements</span>
        <span className="text-text-faint">{statements.length} of 100 by total time</span>
        {statisticsWindow && statisticsSince ? (
          <span className="text-text-faint">
            Statistics since {statisticsWindow.approximate ? '~' : ''}
            <time dateTime={statisticsWindow.since}>{statisticsSince}</time>
          </span>
        ) : null}
        <Button
          variant="secondary"
          size="sm"
          onClick={refresh}
          disabled={snapshotQuery.isFetching || advicePending}
          className="ml-auto"
        >
          <RefreshCw size={12} className={clsx(snapshotQuery.isFetching && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {snapshotQuery.isLoading ? (
          <p className="px-sm py-3 text-xs italic text-text-faint">Loading performance insights…</p>
        ) : snapshotQuery.isError ? (
          <p className="px-sm py-3 text-xs text-danger" role="alert">
            {apiErrorDetail(snapshotQuery.error, 'Failed to load performance insights.')}
          </p>
        ) : snapshotQuery.data?.status === 'unavailable' ? (
          <div className="flex max-w-2xl flex-col gap-xs px-sm py-4">
            <p className="text-sm font-medium text-text">Performance insights are not available</p>
            <p className="text-xs text-text-faint">{snapshotQuery.data.message}</p>
          </div>
        ) : statements.length === 0 ? (
          <p className="px-sm py-3 text-xs italic text-text-faint">
            No statement statistics have been collected yet.
          </p>
        ) : (
          <table className="min-w-[760px] w-full border-collapse text-xs">
            <thead className="sticky top-0 z-10 bg-surface-sunken text-text-faint">
              <tr>
                {COLUMNS.map((column) => (
                  <th
                    key={column.key}
                    className={clsx(
                      'border-b border-border px-2 py-1 font-medium',
                      column.numeric ? 'text-right' : 'text-left',
                    )}
                    aria-sort={
                      sort.key === column.key
                        ? sort.direction === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : 'none'
                    }
                  >
                    <Tooltip content={column.description}>
                      <button
                        type="button"
                        aria-label={`${column.label}: ${column.description}`}
                        onClick={() => toggleSort(column.key)}
                        className={clsx(
                          'inline-flex items-center gap-0.5 hover:text-text',
                          column.numeric && 'justify-end',
                        )}
                      >
                        {column.label}
                        {sort.key === column.key ? (
                          sort.direction === 'asc' ? (
                            <ChevronUp size={11} />
                          ) : (
                            <ChevronDown size={11} />
                          )
                        ) : null}
                      </button>
                    </Tooltip>
                  </th>
                ))}
                {writable ? (
                  <th className="border-b border-border px-2 py-1 text-right font-medium">
                    Actions
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {statements.map((statement) => {
                const active = statement.query === activeQuery;
                return (
                  <Fragment key={statement.query}>
                    <tr className="border-b border-border/60 align-top hover:bg-surface-hover">
                      <td className="max-w-[36rem] px-2 py-1.5">
                        <code className="line-clamp-2 text-text" title={statement.query}>
                          {statement.query}
                        </code>
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-text-muted">
                        {formatCount(statement.calls)}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-text-muted">
                        {formatDuration(statement.meanTimeMs)}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums font-medium text-text">
                        {formatDuration(statement.totalTimeMs)}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-text-muted">
                        {formatCount(statement.rows)}
                      </td>
                      {writable ? (
                        <td className="whitespace-nowrap px-2 py-1 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={advicePending}
                            onClick={() => void suggestIndexes(statement.query)}
                          >
                            Suggest indexes
                          </Button>
                        </td>
                      ) : null}
                    </tr>
                    {active ? (
                      <tr className="border-b border-border bg-surface-sunken/40">
                        <td colSpan={COLUMNS.length + (writable ? 1 : 0)} className="px-md py-md">
                          {planUnavailable ? (
                            <p className="mb-sm text-xs text-text-faint">
                              The normalized statement could not be re-planned without its original
                              parameters. Advice is based on the SQL shape and live schema metadata.
                            </p>
                          ) : null}
                          <SchemaSuggestionList
                            connectionId={connectionId}
                            suggestions={advice.suggestions ?? []}
                            loading={advicePending}
                            error={advice.error}
                          />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
