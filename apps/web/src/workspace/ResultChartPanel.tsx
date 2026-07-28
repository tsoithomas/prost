import { useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { ChartAggregation, ChartType, ColumnMetadata } from '@prost/shared-types';
import { Button, ResultChart, Toast } from '@prost/ui';
import { classifyDataType, dataTypeColorVar } from '../grid/columnDefs';
import { aggregateChartData } from './chartData';
import { useLlmEndpoints, useSuggestChart } from '../api/ai';
import { useToasts } from '../hooks/useToasts';
import { apiErrorDetail } from '../lib/apiClient';
import { useAiStore } from '../stores/aiStore';

/** Rows sent to the model for a chart suggestion — a small, capped slice (server re-caps to 15). */
const SUGGEST_SAMPLE_ROWS = 15;

/** Categorical palette for pie slices; bar/line use the value column's type color (first entry). */
const PIE_PALETTE = [
  'var(--color-data-number)',
  'var(--color-data-string)',
  'var(--color-data-decimal)',
  'var(--color-data-boolean)',
  'var(--color-data-temporal)',
  'var(--color-accent)',
];

const CHART_TYPES: { value: ChartType; label: string }[] = [
  { value: 'bar', label: 'Bar' },
  { value: 'line', label: 'Line' },
  { value: 'pie', label: 'Pie' },
];

const AGGREGATIONS: { value: ChartAggregation; label: string }[] = [
  { value: 'sum', label: 'Sum' },
  { value: 'avg', label: 'Average' },
  { value: 'count', label: 'Count' },
  { value: 'min', label: 'Min' },
  { value: 'max', label: 'Max' },
  { value: 'none', label: 'None (raw)' },
];

/** A numeric column is a natural value (y) axis; used to seed a sensible default. */
function isNumeric(column: ColumnMetadata): boolean {
  const category = classifyDataType(column.dataType);
  return category === 'integer' || category === 'decimal';
}

export interface ResultChartPanelProps {
  connectionId: string;
  columns: ColumnMetadata[];
  /** The already-loaded result page — read directly, never re-fetched (principle §7). */
  rows: Record<string, unknown>[];
}

/**
 * Client-side chart view over an already-loaded result page (Phase 29). Manual type/category/value
 * pickers always work; "Suggest a chart" (shown only when an LLM endpoint exists) pre-fills them.
 */
export function ResultChartPanel({ connectionId, columns, rows }: ResultChartPanelProps) {
  const { data: endpoints = [] } = useLlmEndpoints();
  const selectedEndpointId = useAiStore((s) => s.selectedEndpointId);
  const selectedModel = useAiStore((s) => s.selectedModel);
  const suggestChart = useSuggestChart(connectionId);
  const { toasts, push: pushToast, dismiss: dismissToast } = useToasts();

  // Sensible defaults: first numeric column as value, first other column as category.
  const defaults = useMemo(() => {
    const numeric = columns.find(isNumeric);
    const value = numeric ?? columns[0];
    const category = columns.find((c) => c.name !== value?.name) ?? columns[0];
    return { category: category?.name ?? '', value: value?.name ?? '' };
  }, [columns]);

  const [type, setType] = useState<ChartType>('bar');
  const [categoryKey, setCategoryKey] = useState(defaults.category);
  const [valueKey, setValueKey] = useState(defaults.value);
  // Group by the category column by default (Sum), so a raw multi-row result is useful without a
  // hand-written GROUP BY. 'none' restores the raw 1:1 plotting.
  const [aggregation, setAggregation] = useState<ChartAggregation>('sum');

  const valueColumn = columns.find((c) => c.name === valueKey);
  const colors = useMemo(() => {
    const valueColor = valueColumn ? dataTypeColorVar(valueColumn.dataType) : 'var(--color-accent)';
    return type === 'pie' ? PIE_PALETTE : [valueColor, ...PIE_PALETTE];
  }, [type, valueColumn]);

  // Aggregate the already-loaded page in the browser — no re-fetch (principle §7).
  const chartData = useMemo(
    () => aggregateChartData(rows, categoryKey, valueKey, aggregation),
    [rows, categoryKey, valueKey, aggregation],
  );
  // 'count' ignores the value column, so label the series honestly.
  const valueLabel = aggregation === 'count' ? 'Count' : valueKey;

  function handleSuggest() {
    if (!selectedEndpointId || !selectedModel) {
      pushToast('danger', 'Pick an AI model in the assistant panel first.');
      return;
    }
    suggestChart.mutate(
      {
        endpointId: selectedEndpointId,
        model: selectedModel,
        columns,
        sample: rows.slice(0, SUGGEST_SAMPLE_ROWS),
      },
      {
        onSuccess: ({ suggestion }) => {
          if (!suggestion) {
            pushToast('danger', 'The model could not suggest a chart for this result.');
            return;
          }
          setType(suggestion.type);
          setCategoryKey(suggestion.categoryColumn);
          setValueKey(suggestion.valueColumn);
          setAggregation(suggestion.aggregation);
        },
        onError: (error) => pushToast('danger', apiErrorDetail(error, 'Chart suggestion failed.')),
      },
    );
  }

  const selectCls =
    'h-7 rounded-sm border border-border bg-surface px-sm text-xs text-text focus:border-accent focus:outline-none';

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-sm border-b border-border bg-surface p-sm">
        <label className="flex items-center gap-xs text-xs text-text-faint">
          Type
          <select className={selectCls} value={type} onChange={(e) => setType(e.target.value as ChartType)} aria-label="Chart type">
            {CHART_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-xs text-xs text-text-faint">
          Category
          <select className={selectCls} value={categoryKey} onChange={(e) => setCategoryKey(e.target.value)} aria-label="Category column">
            {columns.map((c) => (
              <option key={c.name} value={c.name}>{c.name}</option>
            ))}
          </select>
        </label>
        {/* Count ignores the value column (it counts rows per category), so hide the picker entirely
            rather than showing it disabled. */}
        {aggregation !== 'count' ? (
          <label className="flex items-center gap-xs text-xs text-text-faint">
            Value
            <select className={selectCls} value={valueKey} onChange={(e) => setValueKey(e.target.value)} aria-label="Value column">
              {columns.map((c) => (
                <option key={c.name} value={c.name}>{c.name}</option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="flex items-center gap-xs text-xs text-text-faint">
          Aggregate
          <select className={selectCls} value={aggregation} onChange={(e) => setAggregation(e.target.value as ChartAggregation)} aria-label="Aggregation">
            {AGGREGATIONS.map((a) => (
              <option key={a.value} value={a.value}>{a.label}</option>
            ))}
          </select>
        </label>
        {endpoints.length > 0 ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="ml-auto"
            onClick={handleSuggest}
            disabled={suggestChart.isPending}
          >
            <Sparkles size={13} />
            {suggestChart.isPending ? 'Suggesting…' : 'Suggest a chart'}
          </Button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 p-sm">
        {categoryKey && valueKey ? (
          <ResultChart type={type} data={chartData} categoryKey={categoryKey} valueKey={valueKey} valueLabel={valueLabel} colors={colors} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-text-faint">
            This result has no columns to chart.
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
    </div>
  );
}
