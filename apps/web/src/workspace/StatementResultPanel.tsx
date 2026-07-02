import clsx from 'clsx';
import { AgGridReact } from 'ag-grid-react';
import type { StatementResult } from '@prost/shared-types';
import { Badge, Surface, prostGridTheme } from '@prost/ui';
import { buildColumnDefs } from '../grid/columnDefs';
import { FixWithAiButton } from '../ai/FixWithAiButton';

export interface PlanPanelProps {
  planText: string;
  analyze: boolean;
  className?: string;
}

export function PlanPanel({ planText, analyze, className }: PlanPanelProps) {
  return (
    <Surface bordered className={clsx('overflow-auto p-sm', className)}>
      {analyze ? (
        <div className="mb-xs">
          <Badge variant="warning">This executes</Badge>
        </div>
      ) : null}
      <pre className="font-mono text-xs whitespace-pre">{planText}</pre>
    </Surface>
  );
}

export interface StatementResultPanelProps {
  index: number;
  total: number;
  statement: StatementResult;
}

export function StatementResultPanel({ index, total, statement }: StatementResultPanelProps) {
  return (
    <Surface bordered data-testid={`statement-panel-${index}`} className="flex flex-col gap-xs p-sm">
      <div className="flex flex-wrap items-center gap-xs text-xs text-text-faint">
        <Badge variant="neutral">
          #{index + 1} of {total}
        </Badge>
        {statement.kind === 'rows' ? (
          <>
            {statement.truncated ? <Badge variant="warning">Truncated</Badge> : null}
            <span>
              {statement.rows.length} row{statement.rows.length === 1 ? '' : 's'} · {statement.executionTimeMs} ms
            </span>
          </>
        ) : null}
        {statement.kind === 'command' ? (
          <span>
            {statement.command} · {statement.rowCount} row{statement.rowCount === 1 ? '' : 's'} affected · {statement.executionTimeMs} ms
          </span>
        ) : null}
        {statement.kind === 'plan' ? (
          <>
            {statement.analyze ? <Badge variant="warning">Analyze</Badge> : null}
            <span>{statement.executionTimeMs} ms</span>
          </>
        ) : null}
        {statement.kind === 'error' ? <Badge variant="danger">{statement.code ?? 'SQL_ERROR'}</Badge> : null}
      </div>
      {statement.kind === 'rows' ? (
        <div className="h-96">
          <AgGridReact theme={prostGridTheme} rowData={statement.rows} columnDefs={buildColumnDefs(statement.columns, false)} />
        </div>
      ) : null}
      {statement.kind === 'command' ? (
        <div className="flex h-16 items-center justify-center text-sm text-text-faint">
          {statement.command} — {statement.rowCount} row{statement.rowCount === 1 ? '' : 's'} affected.
        </div>
      ) : null}
      {statement.kind === 'plan' ? <PlanPanel planText={statement.planText} analyze={statement.analyze} className="max-h-96" /> : null}
      {statement.kind === 'error' ? (
        <div className="flex flex-col items-center gap-xs p-md text-center">
          <p className="max-w-[28rem] text-sm text-text">{statement.message}</p>
          <p className="text-xs text-text-faint">ref: {statement.correlationId}</p>
          <FixWithAiButton sql={statement.sql} message={statement.message} code={statement.code} className="mt-sm" />
        </div>
      ) : null}
    </Surface>
  );
}
