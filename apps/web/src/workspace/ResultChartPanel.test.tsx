import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ColumnMetadata } from '@prost/shared-types';
import { ResultChartPanel } from './ResultChartPanel';
import { renderWithProviders } from '../test/renderWithProviders';
import { useAiStore } from '../stores/aiStore';

// Stub the recharts-backed primitive; the panel test only cares which type/columns/data it receives.
vi.mock('@prost/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@prost/ui')>();
  return {
    ...actual,
    ResultChart: (props: {
      type: string;
      categoryKey: string;
      valueKey: string;
      valueLabel?: string;
      data: Record<string, unknown>[];
    }) => (
      <div
        data-testid="chart"
        data-type={props.type}
        data-category={props.categoryKey}
        data-value={props.valueKey}
        data-label={props.valueLabel}
        data-points={props.data.length}
        data-rows={JSON.stringify(props.data)}
      />
    ),
  };
});

const mockSuggestMutate = vi.fn();
let mockEndpoints: unknown[] = [
  { id: 'ep-1', name: 'E', baseUrl: '', models: ['m1'], hasApiKey: true, contextBudget: null, maxOutputTokens: null, createdAt: '' },
];

vi.mock('../api/ai', () => ({
  useLlmEndpoints: () => ({ data: mockEndpoints }),
  useSuggestChart: () => ({ mutate: mockSuggestMutate, isPending: false }),
}));

function col(name: string, dataType: string): ColumnMetadata {
  return { name, dataType, nullable: true, isPrimaryKey: false, autoIncrement: false, defaultValue: null };
}

const COLUMNS = [col('status', 'text'), col('count', 'integer')];
const ROWS = [
  { status: 'open', count: 3 },
  { status: 'closed', count: 7 },
];

afterEach(() => {
  vi.clearAllMocks();
  mockEndpoints = [
    { id: 'ep-1', name: 'E', baseUrl: '', models: ['m1'], hasApiKey: true, contextBudget: null, maxOutputTokens: null, createdAt: '' },
  ];
  useAiStore.setState({ selectedEndpointId: null, selectedModel: null });
});

describe('ResultChartPanel', () => {
  it('defaults to the first numeric column as value, another as category, and Sum aggregation', () => {
    renderWithProviders(<ResultChartPanel connectionId="conn-1" columns={COLUMNS} rows={ROWS} />);
    const chart = screen.getByTestId('chart');
    expect(chart).toHaveAttribute('data-value', 'count');
    expect(chart).toHaveAttribute('data-category', 'status');
    expect(chart).toHaveAttribute('data-type', 'bar');
    expect(screen.getByLabelText('Aggregation')).toHaveValue('sum');
  });

  it('updates the chart when the value column is changed', async () => {
    renderWithProviders(<ResultChartPanel connectionId="conn-1" columns={COLUMNS} rows={ROWS} />);
    await userEvent.selectOptions(screen.getByLabelText('Value column'), 'status');
    expect(screen.getByTestId('chart')).toHaveAttribute('data-value', 'status');
  });

  it('groups rows by category by default (Sum) and passes raw rows for None', async () => {
    // Two "open" rows + one "closed" row → Sum collapses to 2 points; None keeps all 3.
    const rows = [
      { status: 'open', count: 3 },
      { status: 'open', count: 4 },
      { status: 'closed', count: 7 },
    ];
    renderWithProviders(<ResultChartPanel connectionId="conn-1" columns={COLUMNS} rows={rows} />);
    expect(screen.getByTestId('chart')).toHaveAttribute('data-points', '2');

    await userEvent.selectOptions(screen.getByLabelText('Aggregation'), 'none');
    expect(screen.getByTestId('chart')).toHaveAttribute('data-points', '3');
  });

  it('hides the value picker and labels the series "Count" for Count aggregation', async () => {
    renderWithProviders(<ResultChartPanel connectionId="conn-1" columns={COLUMNS} rows={ROWS} />);
    expect(screen.getByLabelText('Value column')).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Aggregation'), 'count');
    // Count ignores the value column, so the picker is removed rather than shown disabled.
    expect(screen.queryByLabelText('Value column')).not.toBeInTheDocument();
    expect(screen.getByTestId('chart')).toHaveAttribute('data-label', 'Count');
  });

  it('pre-fills the pickers (incl. aggregation) from an AI suggestion', async () => {
    useAiStore.setState({ selectedEndpointId: 'ep-1', selectedModel: 'm1' });
    mockSuggestMutate.mockImplementation((_req, cbs) =>
      cbs.onSuccess({ suggestion: { type: 'pie', categoryColumn: 'status', valueColumn: 'count', aggregation: 'avg' } }),
    );

    renderWithProviders(<ResultChartPanel connectionId="conn-1" columns={COLUMNS} rows={ROWS} />);
    await userEvent.click(screen.getByRole('button', { name: /suggest a chart/i }));

    expect(mockSuggestMutate).toHaveBeenCalledWith(
      expect.objectContaining({ endpointId: 'ep-1', model: 'm1', columns: COLUMNS }),
      expect.any(Object),
    );
    expect(screen.getByTestId('chart')).toHaveAttribute('data-type', 'pie');
    expect(screen.getByLabelText('Aggregation')).toHaveValue('avg');
  });

  it('caps the suggestion sample to 15 rows', async () => {
    useAiStore.setState({ selectedEndpointId: 'ep-1', selectedModel: 'm1' });
    const manyRows = Array.from({ length: 40 }, (_, i) => ({ status: 's', count: i }));
    renderWithProviders(<ResultChartPanel connectionId="conn-1" columns={COLUMNS} rows={manyRows} />);
    await userEvent.click(screen.getByRole('button', { name: /suggest a chart/i }));
    const req = mockSuggestMutate.mock.calls[0]![0] as { sample: unknown[] };
    expect(req.sample).toHaveLength(15);
  });

  it('hides "Suggest a chart" when no LLM endpoint is configured', () => {
    mockEndpoints = [];
    renderWithProviders(<ResultChartPanel connectionId="conn-1" columns={COLUMNS} rows={ROWS} />);
    expect(screen.queryByRole('button', { name: /suggest a chart/i })).not.toBeInTheDocument();
    // Manual charting still renders.
    expect(screen.getByTestId('chart')).toBeInTheDocument();
  });
});
