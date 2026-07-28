import type { ChartType } from '@prost/shared-types';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export interface ResultChartProps {
  type: ChartType;
  /** The already-loaded result rows (a page), read directly — no fetching here. */
  data: Record<string, unknown>[];
  /** Column used for the x-axis / pie-slice label. */
  categoryKey: string;
  /** Numeric column used for the y-axis / pie-slice size. */
  valueKey: string;
  /** Series label for the tooltip/legend; defaults to `valueKey` (e.g. "Count" for a count chart). */
  valueLabel?: string;
  /**
   * Series palette as CSS values — pass `var(--color-*)` strings so the chart re-themes live on
   * light/dark + accent change with no JS (the same trick the AG Grid theme uses). Bar/line use the
   * first color; pie cycles through all of them.
   */
  colors: string[];
}

interface Point {
  name: string;
  value: number;
}

/** Map the raw result rows to `{ name, value }` points, dropping rows whose value isn't numeric. */
function toPoints(data: Record<string, unknown>[], categoryKey: string, valueKey: string): Point[] {
  const points: Point[] = [];
  for (const row of data) {
    const value = Number(row[valueKey]);
    if (Number.isNaN(value)) continue;
    points.push({ name: String(row[categoryKey] ?? ''), value });
  }
  return points;
}

// Axis/grid/tooltip chrome all reference tokens so the chart matches the grid in both themes.
const AXIS_TICK = { fill: 'var(--color-text-faint)', fontSize: 11 };
const GRID_STROKE = 'var(--color-border)';
const TOOLTIP_STYLE = {
  background: 'var(--color-surface-overlay)',
  border: '1px solid var(--color-border)',
  borderRadius: 6,
  color: 'var(--color-text)',
  fontSize: 12,
};

/**
 * A presentational chart over an already-loaded result page (bar/line/pie). Dumb by design: it holds
 * no data-fetching and no theme JS — colors arrive as `var(--color-*)` strings and resolve live.
 */
export function ResultChart({ type, data, categoryKey, valueKey, valueLabel, colors }: ResultChartProps) {
  const points = toPoints(data, categoryKey, valueKey);
  const primary = colors[0] ?? 'var(--color-accent)';
  const seriesName = valueLabel ?? valueKey;

  if (points.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-md text-center text-sm text-text-faint">
        No numeric values in “{valueKey}” to chart.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      {type === 'bar' ? (
        <BarChart data={points} margin={{ top: 12, right: 16, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
          <XAxis dataKey="name" tick={AXIS_TICK} stroke={GRID_STROKE} />
          <YAxis tick={AXIS_TICK} stroke={GRID_STROKE} />
          <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'var(--color-surface-hover)' }} />
          <Bar dataKey="value" name={seriesName} fill={primary} />
        </BarChart>
      ) : type === 'line' ? (
        <LineChart data={points} margin={{ top: 12, right: 16, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
          <XAxis dataKey="name" tick={AXIS_TICK} stroke={GRID_STROKE} />
          <YAxis tick={AXIS_TICK} stroke={GRID_STROKE} />
          <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ stroke: 'var(--color-border-strong)' }} />
          <Line type="monotone" dataKey="value" name={seriesName} stroke={primary} dot={false} />
        </LineChart>
      ) : (
        <PieChart>
          <Tooltip contentStyle={TOOLTIP_STYLE} />
          <Legend wrapperStyle={{ fontSize: 12, color: 'var(--color-text-faint)' }} />
          <Pie data={points} dataKey="value" nameKey="name" outerRadius="80%" label>
            {points.map((point, i) => (
              <Cell key={`${point.name}-${i}`} fill={colors[i % colors.length] ?? primary} />
            ))}
          </Pie>
        </PieChart>
      )}
    </ResponsiveContainer>
  );
}
