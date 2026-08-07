import { useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { IconButton, Modal, Tooltip } from '@prost/ui';
import { SchemaSuggestionList } from '../ddl/SchemaSuggestionList';
import { useSchemaSuggestions } from '../ddl/useSchemaSuggestions';
import { useSchemaOverview, useTableStructure } from '../api/metadata';
import { formatBytes, formatRows } from '../lib/formatSize';

export interface TableStructureToolbarProps {
  connectionId: string;
  schema: string;
  table: string;
  /** Read-only connections hide the suggestion entry point; the server refuses it there anyway. */
  writable?: boolean;
}

/**
 * The Structure view's slice of `TableView`'s toolbar: a one-line size summary and the AI
 * suggestion entry point. Both used to sit inside `TableStructurePanel`, where they cost vertical
 * space above the tables people actually came to read. Both reads are the same react-query keys the
 * panel already uses, so mounting this alongside it costs no extra request.
 *
 * Rendered leading (left-aligned) in the toolbar: every control on that side belongs to the Rows
 * view, so in Structure mode it would otherwise sit empty while these crowded the view-mode toggle.
 */
export function TableStructureToolbar({ connectionId, schema, table, writable = true }: TableStructureToolbarProps) {
  const { data } = useTableStructure(connectionId, schema, table);
  const { data: overview } = useSchemaOverview(connectionId, schema);
  const suggest = useSchemaSuggestions(connectionId);
  const [suggestOpen, setSuggestOpen] = useState(false);

  const stats = overview?.tables.find((t) => t.name === table);

  // Zero counts are dropped — "0 foreign keys" is noise in a summary line, and each section heading
  // below carries the authoritative count anyway. Rows/size are null on SQLite.
  const segments: string[] = [];
  if (stats?.rowEstimate != null) segments.push(`${formatRows(stats.rowEstimate)} rows`);
  if (stats?.sizeBytes != null) segments.push(formatBytes(stats.sizeBytes));
  if (data) {
    segments.push(`${data.columns.length} ${data.columns.length === 1 ? 'column' : 'columns'}`);
    if (data.indexes.length > 0) {
      segments.push(`${data.indexes.length} ${data.indexes.length === 1 ? 'index' : 'indexes'}`);
    }
    if (data.foreignKeys.length > 0) {
      segments.push(`${data.foreignKeys.length} foreign ${data.foreignKeys.length === 1 ? 'key' : 'keys'}`);
    }
  }

  function openSuggestions() {
    setSuggestOpen(true);
    suggest.request({ tables: [{ schema, table }] });
  }

  function closeSuggestions() {
    setSuggestOpen(false);
    // Drop the previous answer so reopening doesn't flash stale advice before the new request lands.
    suggest.reset();
  }

  return (
    <>
      {segments.length > 0 ? (
        <span className="px-sm text-xs text-text-faint">{segments.join(' · ')}</span>
      ) : null}
      {segments.length > 0 && writable ? <div className="mx-1 h-4 w-px bg-border" /> : null}
      {writable ? (
        <Tooltip content="Suggest schema improvements">
          <IconButton
            aria-label="Suggest improvements"
            onClick={openSuggestions}
            disabled={suggest.isPending}
          >
            <Sparkles size={14} />
          </IconButton>
        </Tooltip>
      ) : null}

      {suggestOpen ? (
        <Modal
          open
          onClose={closeSuggestions}
          title={`Schema suggestions for ${schema}.${table}`}
          hideTitle
          className="w-full max-w-[42rem] overflow-hidden"
        >
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-lg">
            <h2 className="truncate text-sm font-semibold text-text">
              Suggestions for{' '}
              <span className="font-mono">
                {schema}.{table}
              </span>
            </h2>
            <IconButton aria-label="Close" onClick={closeSuggestions}>
              <X size={16} />
            </IconButton>
          </div>
          <div className="max-h-[60vh] overflow-y-auto p-lg">
            <SchemaSuggestionList
              connectionId={connectionId}
              suggestions={suggest.suggestions ?? []}
              loading={suggest.isPending}
              error={suggest.error}
            />
          </div>
        </Modal>
      ) : null}
    </>
  );
}
