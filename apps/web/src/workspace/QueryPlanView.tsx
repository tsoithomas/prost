import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Copy } from 'lucide-react';
import clsx from 'clsx';
import type { QueryPlanNode, QueryPlanResult } from '@prost/shared-types';
import { Badge } from '@prost/ui';

/** The value a node is heat-weighted by: actual time under ANALYZE, else estimated cost. */
function nodeMetric(node: QueryPlanNode, analyze: boolean): number | undefined {
  return analyze ? node.actualTimeMs : node.estimatedCost;
}

function maxMetric(node: QueryPlanNode, analyze: boolean): number {
  return node.children.reduce((max, child) => Math.max(max, maxMetric(child, analyze)), nodeMetric(node, analyze) ?? 0);
}

type Heat = 'cool' | 'warm' | 'hot';

/** Relative heat of a node vs. the most expensive node in the plan. */
function heatOf(node: QueryPlanNode, analyze: boolean, max: number): Heat {
  const metric = nodeMetric(node, analyze);
  if (metric === undefined || max <= 0) return 'cool';
  const ratio = metric / max;
  if (ratio >= 0.66) return 'hot';
  if (ratio >= 0.33) return 'warm';
  return 'cool';
}

// Token-driven heat scale (principle §9 — no hardcoded hex).
const HEAT_CLASS: Record<Heat, string> = { cool: '', warm: 'bg-warning/10', hot: 'bg-danger/15' };

function formatCost(value: number): string {
  return value >= 1000 ? Math.round(value).toLocaleString() : value.toFixed(2);
}

interface PlanNodeRowProps {
  node: QueryPlanNode;
  depth: number;
  analyze: boolean;
  max: number;
}

function PlanNodeRow({ node, depth, analyze, max }: PlanNodeRowProps) {
  const [expanded, setExpanded] = useState(true);
  const [showDetail, setShowDetail] = useState(false);
  const hasChildren = node.children.length > 0;
  const hasFields = !!node.fields && Object.keys(node.fields).length > 0;
  const heat = heatOf(node, analyze, max);

  return (
    <div>
      <div
        data-heat={heat}
        className={clsx('flex items-start gap-1 rounded-sm py-1 pr-1 text-xs', HEAT_CLASS[heat])}
        style={{ paddingLeft: `${depth * 16 + 4}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-label={expanded ? 'Collapse node' : 'Expand node'}
            className="mt-0.5 shrink-0 text-text-faint hover:text-text"
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        ) : (
          <span className="w-3 shrink-0" aria-hidden />
        )}
        <button
          type="button"
          onClick={() => hasFields && setShowDetail((value) => !value)}
          className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left"
          title={hasFields ? 'Show node details' : undefined}
        >
          <span className="flex flex-wrap items-baseline gap-1">
            <span className="font-medium text-text">{node.nodeType}</span>
            {node.detail ? <span className="truncate text-text-muted">{node.detail}</span> : null}
          </span>
          <span className="flex flex-wrap items-center gap-1 text-text-faint">
            {analyze ? (
              <>
                {node.actualTimeMs !== undefined ? <Badge variant="neutral">{node.actualTimeMs.toFixed(2)} ms</Badge> : null}
                {node.actualRows !== undefined ? <span>{node.actualRows.toLocaleString()} rows</span> : null}
              </>
            ) : (
              <>
                {node.estimatedCost !== undefined ? <Badge variant="neutral">cost {formatCost(node.estimatedCost)}</Badge> : null}
                {node.estimatedRows !== undefined ? <span>~{node.estimatedRows.toLocaleString()} rows</span> : null}
              </>
            )}
          </span>
        </button>
      </div>

      {showDetail && hasFields ? (
        <div
          className="mb-1 flex flex-col gap-0.5 border-l border-border pl-2 text-[11px] text-text-muted"
          style={{ marginLeft: `${depth * 16 + 16}px` }}
        >
          {Object.entries(node.fields!).map(([key, value]) => (
            <div key={key}>
              <span className="text-text-faint">{key}:</span> {String(value)}
            </div>
          ))}
        </div>
      ) : null}

      {hasChildren && expanded
        ? node.children.map((child, index) => (
            <PlanNodeRow key={index} node={child} depth={depth + 1} analyze={analyze} max={max} />
          ))
        : null}
    </div>
  );
}

export interface QueryPlanViewProps {
  plan: QueryPlanResult;
  className?: string;
}

/**
 * Renders a `QueryPlanResult` as an expandable, heat-weighted tree (Phase 26). The most expensive
 * node (by estimated cost, or actual time under ANALYZE) stands out via the danger/warning tokens.
 */
export function QueryPlanView({ plan, className }: QueryPlanViewProps) {
  const max = useMemo(() => maxMetric(plan.root, plan.analyze), [plan]);

  return (
    <div className={clsx('flex h-full flex-col', className)}>
      <div className="flex shrink-0 flex-wrap items-center gap-sm border-b border-border bg-surface px-sm py-1.5 text-xs text-text-faint">
        <span className="font-medium text-text">Query plan</span>
        {plan.analyze ? <Badge variant="warning">Analyze · executed</Badge> : <Badge variant="neutral">Estimated</Badge>}
        <span>{plan.executionTimeMs} ms</span>
        <button
          type="button"
          onClick={() => void navigator.clipboard?.writeText(plan.planText)}
          className="ml-auto flex items-center gap-1 text-text-faint hover:text-text"
        >
          <Copy size={12} />
          Copy
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-sm">
        <PlanNodeRow node={plan.root} depth={0} analyze={plan.analyze} max={max} />
      </div>
    </div>
  );
}
