import { Badge } from '@prost/ui';
import { useTableStructure } from '../api/metadata';

export interface TableStructurePanelProps {
  connectionId: string;
  schema: string;
  table: string;
}

export function TableStructurePanel({ connectionId, schema, table }: TableStructurePanelProps) {
  const { data, isLoading, isError } = useTableStructure(connectionId, schema, table);

  if (isLoading) {
    return <p className="px-lg py-md text-sm text-text-faint">Loading structure…</p>;
  }

  if (isError) {
    return <p className="px-lg py-md text-sm text-danger">Failed to load table structure.</p>;
  }

  if (!data) return null;

  return (
    <div className="flex-1 space-y-lg overflow-y-auto p-lg">
      <section>
        <h2 className="mb-sm text-xs font-medium uppercase tracking-wider text-text-faint">
          Columns ({data.columns.length})
        </h2>
        <div className="overflow-hidden rounded-md border border-border">
          {data.columns.map((col, i) => (
            <div
              key={col.name}
              className={`flex items-center gap-sm px-md py-sm text-sm ${i < data.columns.length - 1 ? 'border-b border-border' : ''}`}
            >
              <span className="min-w-0 flex-1 font-medium text-text">{col.name}</span>
              <span className="shrink-0 font-mono text-xs text-text-faint">{col.dataType}</span>
              {col.isPrimaryKey ? <Badge variant="accent">PK</Badge> : null}
              {!col.nullable && !col.isPrimaryKey ? <Badge variant="neutral">NOT NULL</Badge> : null}
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-sm text-xs font-medium uppercase tracking-wider text-text-faint">
          Indexes ({data.indexes.length})
        </h2>
        {data.indexes.length === 0 ? (
          <p className="text-sm italic text-text-faint">No indexes.</p>
        ) : (
          <div className="overflow-hidden rounded-md border border-border">
            {data.indexes.map((idx, i) => (
              <div
                key={idx.name}
                className={`flex flex-col gap-xs px-md py-sm ${i < data.indexes.length - 1 ? 'border-b border-border' : ''}`}
              >
                <div className="flex flex-wrap items-center gap-xs">
                  <span className="font-medium text-text">{idx.name}</span>
                  {idx.isPrimary ? <Badge variant="accent">Primary</Badge> : null}
                  {idx.isUnique && !idx.isPrimary ? <Badge variant="success">Unique</Badge> : null}
                  <span className="text-xs text-text-faint">{idx.method}</span>
                </div>
                <span className="font-mono text-xs text-text-faint">{idx.columns.join(', ')}</span>
                <code className="block truncate text-xs text-text-faint" title={idx.definition}>
                  {idx.definition}
                </code>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
