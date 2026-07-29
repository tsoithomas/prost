import { Lightbulb } from 'lucide-react';
import type { SchemaSuggestion, SchemaSuggestionChange } from '@prost/shared-types';
import { Button } from '@prost/ui';
import { useDdlStore } from '../stores/ddlStore';

export interface SchemaSuggestionListProps {
  connectionId: string;
  suggestions: SchemaSuggestion[];
  /** Rendered instead of the empty-state text while a request is in flight. */
  loading?: boolean;
  error?: string | null;
  className?: string;
}

/** A one-line label for a change, so a card reads as an action before you get to the SQL. */
function changeLabel(change: SchemaSuggestionChange): string {
  if (change.kind === 'createIndex') {
    const { schema, table, columns } = change.request;
    return `Index on ${schema}.${table} (${columns.join(', ')})`;
  }
  const { schema, table, operation } = change.request;
  const target = 'column' in operation && typeof operation.column === 'string' ? operation.column : '';
  const verb = {
    addColumn: 'Add column',
    dropColumn: 'Drop column',
    setNotNull: 'Change nullability of',
    setDefault: 'Set default on',
    changeType: 'Change type of',
    addForeignKey: 'Add foreign key on',
    dropForeignKey: 'Drop foreign key on',
  }[operation.kind];
  const name = operation.kind === 'addColumn' ? operation.column.name : target;
  return `${verb} ${schema}.${table}${name ? `.${name}` : ''}`;
}

/** Which table a change targets — where the review modal needs its structure from. */
function targetOf(change: SchemaSuggestionChange): { schema: string; table: string } {
  return { schema: change.request.schema, table: change.request.table };
}

/**
 * Renders AI-proposed schema changes (Phase 33). Each card shows the rationale and the SQL the
 * *server* generated for that change, and hands review to the existing DDL modal via `ddlStore` —
 * nothing here executes anything.
 */
export function SchemaSuggestionList({
  connectionId,
  suggestions,
  loading = false,
  error = null,
  className,
}: SchemaSuggestionListProps) {
  const openDdl = useDdlStore((s) => s.openDdl);

  if (loading) {
    return <p className={`text-xs text-text-faint ${className ?? ''}`}>Looking for schema improvements…</p>;
  }
  if (error) {
    return (
      <p className={`text-xs text-danger ${className ?? ''}`} role="alert">
        {error}
      </p>
    );
  }
  if (suggestions.length === 0) {
    return <p className={`text-xs text-text-faint ${className ?? ''}`}>No schema changes suggested.</p>;
  }

  return (
    <div className={`flex flex-col gap-sm ${className ?? ''}`}>
      {suggestions.map((suggestion, i) => (
        <div key={i} className="flex flex-col gap-sm rounded-md border border-border bg-surface-raised p-md">
          <div className="flex items-start gap-sm">
            <Lightbulb size={14} className="mt-0.5 shrink-0 text-accent" />
            <span className="text-sm font-medium text-text">{changeLabel(suggestion.change)}</span>
          </div>
          <p className="text-xs text-text-faint">{suggestion.rationale}</p>
          <pre className="overflow-x-auto rounded-sm border border-border bg-surface-sunken p-md font-mono text-xs text-text">
            {suggestion.sql}
          </pre>
          <div className="flex justify-end">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => openDdl({ connectionId, ...targetOf(suggestion.change), change: suggestion.change })}
            >
              Review change
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
