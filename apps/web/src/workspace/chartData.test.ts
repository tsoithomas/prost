import { describe, expect, it } from 'vitest';
import { aggregateChartData } from './chartData';

const ROWS = [
  { status: 'open', amount: 10 },
  { status: 'closed', amount: 5 },
  { status: 'open', amount: 20 },
  { status: 'open', amount: 'n/a' }, // non-numeric — skipped by numeric aggregations
  { status: 'closed', amount: 15 },
];

describe('aggregateChartData', () => {
  it('returns rows unchanged for "none"', () => {
    expect(aggregateChartData(ROWS, 'status', 'amount', 'none')).toBe(ROWS);
  });

  it('counts rows per category (value column ignored)', () => {
    expect(aggregateChartData(ROWS, 'status', 'amount', 'count')).toEqual([
      { status: 'open', amount: 3 },
      { status: 'closed', amount: 2 },
    ]);
  });

  it('sums the numeric value per category, skipping non-numeric cells', () => {
    expect(aggregateChartData(ROWS, 'status', 'amount', 'sum')).toEqual([
      { status: 'open', amount: 30 },
      { status: 'closed', amount: 20 },
    ]);
  });

  it('averages, mins, and maxes per category', () => {
    expect(aggregateChartData(ROWS, 'status', 'amount', 'avg')).toEqual([
      { status: 'open', amount: 15 }, // (10 + 20) / 2
      { status: 'closed', amount: 10 }, // (5 + 15) / 2
    ]);
    expect(aggregateChartData(ROWS, 'status', 'amount', 'min')).toEqual([
      { status: 'open', amount: 10 },
      { status: 'closed', amount: 5 },
    ]);
    expect(aggregateChartData(ROWS, 'status', 'amount', 'max')).toEqual([
      { status: 'open', amount: 20 },
      { status: 'closed', amount: 15 },
    ]);
  });

  it('preserves first-seen category order', () => {
    const out = aggregateChartData(ROWS, 'status', 'amount', 'sum');
    expect(out.map((r) => r.status)).toEqual(['open', 'closed']);
  });

  it('drops a category whose values are all non-numeric (no misleading 0)', () => {
    const rows = [
      { status: 'x', amount: 'a' },
      { status: 'y', amount: 4 },
    ];
    expect(aggregateChartData(rows, 'status', 'amount', 'sum')).toEqual([{ status: 'y', amount: 4 }]);
  });
});
