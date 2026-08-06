import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PerformanceInsightsSnapshot, QueryPlanResult } from '@prost/shared-types';
import { ApiError } from '../lib/apiClient';
import { PerformancePanel } from './PerformancePanel';

const refetch = vi.fn();
const explain = vi.fn();
const requestAdvice = vi.fn();
const resetAdvice = vi.fn();

let snapshot: PerformanceInsightsSnapshot = {
  status: 'available',
  statements: [
    { query: 'SELECT fast', calls: 50, meanTimeMs: 2, totalTimeMs: 100, rows: 50 },
    {
      query: 'SELECT slow WHERE user_id = $1',
      calls: 2,
      meanTimeMs: 100,
      totalTimeMs: 200,
      rows: 2,
    },
  ],
};
let snapshotError: Error | null = null;
let adviceState = {
  suggestions: null as [] | null,
  error: null as string | null,
  ready: true,
  isPending: false,
};

vi.mock('../api/performance', () => ({
  usePerformanceInsights: () => ({
    data: snapshot,
    isLoading: false,
    isError: snapshotError !== null,
    error: snapshotError,
    isFetching: false,
    refetch,
  }),
}));

vi.mock('../api/query', () => ({
  useExplainQuery: () => ({ mutateAsync: explain, isPending: false }),
}));

vi.mock('../ddl/useSchemaSuggestions', () => ({
  useSchemaSuggestions: () => ({ ...adviceState, request: requestAdvice, reset: resetAdvice }),
}));

vi.mock('../ddl/SchemaSuggestionList', () => ({
  SchemaSuggestionList: ({ loading, error }: { loading?: boolean; error?: string | null }) => (
    <div data-testid="suggestions">{loading ? 'loading' : (error ?? 'suggestions')}</div>
  ),
}));

const PLAN: QueryPlanResult = {
  root: { nodeType: 'Seq Scan', children: [] },
  analyze: false,
  format: 'json',
  planText: 'Seq Scan',
  executionTimeMs: 2,
};

afterEach(() => {
  snapshot = {
    status: 'available',
    statements: [
      { query: 'SELECT fast', calls: 50, meanTimeMs: 2, totalTimeMs: 100, rows: 50 },
      {
        query: 'SELECT slow WHERE user_id = $1',
        calls: 2,
        meanTimeMs: 100,
        totalTimeMs: 200,
        rows: 2,
      },
    ],
  };
  adviceState = { suggestions: null, error: null, ready: true, isPending: false };
  snapshotError = null;
  refetch.mockReset();
  explain.mockReset();
  requestAdvice.mockReset();
  resetAdvice.mockReset();
});

describe('PerformancePanel', () => {
  it('renders the snapshot in total-time order and sorts locally by another column', async () => {
    render(<PerformancePanel connectionId="c1" />);
    let rows = screen.getAllByRole('row').slice(1);
    expect(within(rows[0]!).getByText('SELECT slow WHERE user_id = $1')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Calls/ }));
    rows = screen.getAllByRole('row').slice(1);
    expect(within(rows[0]!).getByText('SELECT fast')).toBeInTheDocument();
  });

  it('explains cumulative metrics from the column headers', async () => {
    render(<PerformancePanel connectionId="c1" />);

    const calls = screen.getByRole('button', { name: /Calls:/ });
    calls.focus();

    expect(
      await screen.findByRole('tooltip', {}, { timeout: 1_000 }),
    ).toHaveTextContent('Executions since statement statistics were last reset.');
  });

  it('shows the approximate start of the current statistics window', () => {
    const statements = snapshot.status === 'available' ? snapshot.statements : [];
    snapshot = {
      status: 'available',
      statements,
      statisticsWindow: {
        since: '2026-08-05T19:33:17.000Z',
        approximate: true,
      },
    };

    render(<PerformancePanel connectionId="c1" />);

    const label = screen.getByText(/Statistics since ~/);
    expect(label).toContainElement(label.querySelector('time'));
    expect(label.querySelector('time')).toHaveAttribute(
      'datetime',
      '2026-08-05T19:33:17.000Z',
    );
  });

  it('refreshes only on the explicit action and clears open advice', async () => {
    render(<PerformancePanel connectionId="c1" />);
    expect(refetch).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(resetAdvice).toHaveBeenCalled();
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('renders a runtime-unavailable state and hides advisor actions on read-only connections', () => {
    snapshot = {
      status: 'unavailable',
      reason: 'not_configured',
      message: 'pg_stat_statements is not installed in this database.',
    };
    const { rerender } = render(<PerformancePanel connectionId="c1" />);
    expect(screen.getByText('Performance insights are not available')).toBeInTheDocument();
    expect(screen.getByText(snapshot.message)).toBeInTheDocument();

    snapshot = {
      status: 'available',
      statements: [{ query: 'SELECT 1', calls: 1, meanTimeMs: 1, totalTimeMs: 1, rows: 1 }],
    };
    rerender(<PerformancePanel connectionId="c1" writable={false} />);
    expect(screen.queryByRole('button', { name: 'Suggest indexes' })).not.toBeInTheDocument();
  });

  it('shows the API error detail when loading the snapshot fails', () => {
    snapshotError = new ApiError(400, 'SQL_ERROR', 'Performance query failed.', 'corr-41');
    render(<PerformancePanel connectionId="c1" />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Performance query failed. (ref: corr-41)',
    );
  });

  it('uses a safe estimated plan when EXPLAIN succeeds', async () => {
    explain.mockResolvedValue(PLAN);
    render(<PerformancePanel connectionId="c1" />);

    await userEvent.click(screen.getAllByRole('button', { name: 'Suggest indexes' })[0]!);
    await waitFor(() => expect(requestAdvice).toHaveBeenCalled());
    expect(explain).toHaveBeenCalledWith({ sql: 'SELECT slow WHERE user_id = $1', analyze: false });
    expect(requestAdvice).toHaveBeenCalledWith({
      sql: 'SELECT slow WHERE user_id = $1',
      plan: PLAN,
      scope: 'indexes',
    });
  });

  it('falls back to normalized SQL plus schema metadata when the statement cannot be explained', async () => {
    explain.mockRejectedValue(new Error('there is no parameter $1'));
    render(<PerformancePanel connectionId="c1" />);

    await userEvent.click(screen.getAllByRole('button', { name: 'Suggest indexes' })[0]!);
    await waitFor(() =>
      expect(requestAdvice).toHaveBeenCalledWith({
        sql: 'SELECT slow WHERE user_id = $1',
        scope: 'indexes',
      }),
    );
    expect(screen.getByText(/could not be re-planned/)).toBeInTheDocument();
  });
});
