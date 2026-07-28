import type { ChartAggregation } from '@prost/shared-types';

/**
 * Groups an already-loaded result page by `categoryKey` and aggregates `valueKey` per group, so a chart
 * shows one point per category instead of one per row. Pure + client-side (principle §7) — it never
 * re-fetches; it only reshapes the rows the grid already holds.
 *
 * - `none` returns the rows unchanged (raw 1:1 — for a time series or an already-grouped result).
 * - `count` counts rows per category (the value column is ignored).
 * - `sum`/`avg`/`min`/`max` fold the numeric `valueKey`, skipping non-numeric cells; a group with no
 *   numeric values is dropped rather than shown as a misleading 0.
 *
 * Output rows are keyed by the same `categoryKey`/`valueKey` names the chart already reads, and groups
 * keep first-seen order.
 */
export function aggregateChartData(
  rows: Record<string, unknown>[],
  categoryKey: string,
  valueKey: string,
  aggregation: ChartAggregation,
): Record<string, unknown>[] {
  if (aggregation === 'none') return rows;

  // Preserve first-seen category order via an insertion-ordered Map.
  const groups = new Map<string, { count: number; values: number[] }>();
  for (const row of rows) {
    const name = String(row[categoryKey] ?? '');
    let group = groups.get(name);
    if (!group) {
      group = { count: 0, values: [] };
      groups.set(name, group);
    }
    group.count += 1;
    if (aggregation !== 'count') {
      const value = Number(row[valueKey]);
      if (!Number.isNaN(value)) group.values.push(value);
    }
  }

  const result: Record<string, unknown>[] = [];
  for (const [name, group] of groups) {
    if (aggregation === 'count') {
      result.push({ [categoryKey]: name, [valueKey]: group.count });
      continue;
    }
    if (group.values.length === 0) continue; // no numeric values — omit rather than plot a 0
    result.push({ [categoryKey]: name, [valueKey]: foldValues(group.values, aggregation) });
  }
  return result;
}

/** Reduces a group's numeric values by the chosen aggregation (callers exclude `none`/`count`). */
function foldValues(values: number[], aggregation: ChartAggregation): number {
  switch (aggregation) {
    case 'sum':
      return values.reduce((a, b) => a + b, 0);
    case 'avg':
      return values.reduce((a, b) => a + b, 0) / values.length;
    case 'min':
      return Math.min(...values);
    case 'max':
      return Math.max(...values);
    default:
      return values.reduce((a, b) => a + b, 0);
  }
}
