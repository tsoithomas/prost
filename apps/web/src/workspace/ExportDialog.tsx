import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { ExportFormat, ExportRequest, RowFilter } from '@prost/shared-types';
import { Button, IconButton, Input, Surface, Switch } from '@prost/ui';
import { useExport } from '../api/export';
import { apiErrorDetail } from '../lib/apiClient';

/** What a caller can export: a table (optionally with the active filter) or the current query result. */
export type ExportTarget =
  | { scope: 'table'; schema: string; table: string; filter?: RowFilter; sortBy?: string; sortDir?: 'asc' | 'desc' }
  | { scope: 'query'; sql: string; sortBy?: string; sortDir?: 'asc' | 'desc' };

interface Props {
  open: boolean;
  onClose: () => void;
  connectionId: string;
  target: ExportTarget;
}

export function ExportDialog({ open, onClose, connectionId, target }: Props) {
  const [format, setFormat] = useState<ExportFormat>('csv');
  const [delimiter, setDelimiter] = useState(',');
  const [applyFilter, setApplyFilter] = useState(true);
  const [includeSchema, setIncludeSchema] = useState(true);
  const [includeData, setIncludeData] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const exportMutation = useExport(connectionId);

  const hasFilter = target.scope === 'table' && (target.filter?.conditions.length ?? 0) > 0;
  // SQL export needs a target table; a bare query result has none.
  const sqlAllowed = target.scope === 'table';

  useEffect(() => {
    if (!open) {
      setFormat('csv');
      setDelimiter(',');
      setApplyFilter(true);
      setIncludeSchema(true);
      setIncludeData(true);
      setFormError(null);
      exportMutation.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  function handleExport() {
    const base = {
      format,
      ...(format === 'csv' && delimiter ? { delimiter } : {}),
      ...(format === 'sql' ? { includeSchema, includeData } : {}),
    };
    const req: ExportRequest =
      target.scope === 'table'
        ? {
            scope: 'table',
            schema: target.schema,
            table: target.table,
            // SQL export dumps the whole table; a row filter only applies to CSV/JSON.
            ...(format !== 'sql' && hasFilter && applyFilter ? { filter: target.filter } : {}),
            ...(format !== 'sql' && target.sortBy ? { sortBy: target.sortBy, sortDir: target.sortDir ?? 'asc' } : {}),
            ...base,
          }
        : {
            scope: 'query',
            sql: target.sql,
            ...(target.sortBy ? { sortBy: target.sortBy, sortDir: target.sortDir ?? 'asc' } : {}),
            ...base,
          };
    setFormError(null);
    exportMutation.mutate(req, {
      onSuccess: () => onClose(),
      onError: (err) => setFormError(apiErrorDetail(err, 'Export failed.')),
    });
  }

  const selectCls =
    'h-9 w-full rounded-sm border border-border bg-surface px-sm text-xs text-text focus:border-accent focus:outline-none';

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-md md:items-center">
      <Surface level="overlay" bordered className="flex w-full max-w-[28rem] flex-col overflow-hidden rounded-lg shadow-2xl">
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-lg">
          <span className="text-sm font-semibold text-text">
            Export {target.scope === 'table' ? `${target.schema}.${target.table}` : 'query result'}
          </span>
          <IconButton aria-label="Close" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>

        <div className="flex flex-col gap-lg p-lg">
          <label className="flex flex-col gap-xs">
            <span className="text-xs font-medium uppercase tracking-wider text-text-faint">Format</span>
            <select className={selectCls} value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)} aria-label="Export format">
              <option value="csv">CSV</option>
              <option value="json">JSON</option>
              {sqlAllowed ? <option value="sql">SQL</option> : null}
            </select>
          </label>

          {format === 'csv' ? (
            <label className="flex flex-col gap-xs">
              <span className="text-xs font-medium uppercase tracking-wider text-text-faint">Delimiter</span>
              <Input value={delimiter} onChange={(e) => setDelimiter(e.target.value)} maxLength={1} className="w-16 font-mono" aria-label="CSV delimiter" />
            </label>
          ) : null}

          {format === 'sql' ? (
            <div className="flex flex-col gap-sm">
              <label className="flex items-center gap-sm text-sm text-text">
                <Switch checked={includeSchema} onChange={(e) => setIncludeSchema(e.target.checked)} aria-label="Include schema" />
                Include schema (CREATE TABLE)
              </label>
              <label className="flex items-center gap-sm text-sm text-text">
                <Switch checked={includeData} onChange={(e) => setIncludeData(e.target.checked)} aria-label="Include data" />
                Include data (INSERT)
              </label>
            </div>
          ) : null}

          {format !== 'sql' && hasFilter ? (
            <label className="flex items-center gap-sm text-sm text-text">
              <Switch checked={applyFilter} onChange={(e) => setApplyFilter(e.target.checked)} aria-label="Apply current filter" />
              Apply current filter
            </label>
          ) : null}

          <p className="text-xs text-text-faint">
            Large results are streamed and capped at the server's export limit; a truncation note is added if the cap is hit.
          </p>

          {formError ? <p className="text-xs text-danger" role="alert">{formError}</p> : null}
        </div>

        <Surface level="raised" className="flex h-16 shrink-0 items-center justify-end gap-md border-t border-border px-lg">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={handleExport} disabled={exportMutation.isPending}>
            {exportMutation.isPending ? 'Exporting…' : 'Export'}
          </Button>
        </Surface>
      </Surface>
    </div>
  );
}
