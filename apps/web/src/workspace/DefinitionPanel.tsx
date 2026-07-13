import type { SchemaObjectKind } from '@prost/shared-types';
import { Badge } from '@prost/ui';
import { useObjectDefinition } from '../api/metadata';

export interface DefinitionPanelProps {
  connectionId: string;
  schema: string;
  objectKind: SchemaObjectKind;
  objectName: string;
}

/** Human labels for the object kinds, shown as a badge in the panel header. */
const KIND_LABEL: Record<SchemaObjectKind, string> = {
  view: 'View',
  materializedView: 'Materialized View',
  sequence: 'Sequence',
  function: 'Function',
  procedure: 'Procedure',
  trigger: 'Trigger',
  enum: 'Enum',
};

/**
 * Read-only definition view for a non-table schema object (Phase 24). Shows the object's source
 * (from the engine's catalog) in a monospace block plus any engine-specific extras. No edit/execute
 * affordance — browsing only (architecture-principles §13).
 */
export function DefinitionPanel({ connectionId, schema, objectKind, objectName }: DefinitionPanelProps) {
  const { data, isLoading, isError } = useObjectDefinition(connectionId, schema, objectKind, objectName);

  if (isLoading) {
    return <p className="px-lg py-md text-sm text-text-faint">Loading definition…</p>;
  }
  if (isError) {
    return <p className="px-lg py-md text-sm text-danger">Failed to load definition.</p>;
  }
  if (!data) return null;

  const extraEntries = Object.entries(data.extra ?? {});

  return (
    <div className="h-full space-y-lg overflow-y-auto p-lg">
      <div className="flex items-center gap-sm">
        <Badge variant="accent">{KIND_LABEL[objectKind]}</Badge>
        <h2 className="min-w-0 truncate font-medium text-text">
          {schema}.{objectName}
        </h2>
      </div>

      {extraEntries.length > 0 ? (
        <section>
          <h3 className="mb-sm text-xs font-medium uppercase tracking-wider text-text-faint">Details</h3>
          <div className="overflow-hidden rounded-md border border-border">
            {extraEntries.map(([key, value], i) => (
              <div
                key={key}
                className={`flex items-center gap-sm px-md py-sm text-sm ${i < extraEntries.length - 1 ? 'border-b border-border' : ''}`}
              >
                <span className="w-40 shrink-0 text-text-faint">{key}</span>
                <span className="min-w-0 flex-1 font-mono text-xs text-text">{value}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <h3 className="mb-sm text-xs font-medium uppercase tracking-wider text-text-faint">Definition</h3>
        {data.definition ? (
          <pre className="overflow-x-auto rounded-md border border-border bg-surface-sunken p-md font-mono text-xs text-text">
            {data.definition}
          </pre>
        ) : (
          <p className="text-sm italic text-text-faint">No definition available.</p>
        )}
      </section>
    </div>
  );
}
