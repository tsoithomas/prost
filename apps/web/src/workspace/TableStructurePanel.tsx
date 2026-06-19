import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { ColumnMetadata } from '@prost/shared-types';
import { Badge, Button, IconButton } from '@prost/ui';
import { ColumnTypePill } from '../grid/columnDefs';
import { useDropIndex } from '../api/ddl';
import { AddColumnModal } from '../ddl/AddColumnModal';
import { CreateIndexModal } from '../ddl/CreateIndexModal';
import { EditColumnModal } from '../ddl/EditColumnModal';
import { useConfirm } from '../hooks/useConfirm';
import { useTableStructure } from '../api/metadata';

export interface TableStructurePanelProps {
  connectionId: string;
  schema: string;
  table: string;
  /** Read-only connections (the app DB) hide all DDL actions. */
  writable?: boolean;
}

export function TableStructurePanel({ connectionId, schema, table, writable = true }: TableStructurePanelProps) {
  const { data, isLoading, isError } = useTableStructure(connectionId, schema, table);

  const [addColumnOpen, setAddColumnOpen] = useState(false);
  const [editingColumn, setEditingColumn] = useState<ColumnMetadata | null>(null);
  const [createIndexOpen, setCreateIndexOpen] = useState(false);

  const dropIndex = useDropIndex(connectionId, schema, table);
  const { confirm, dialog: confirmDialog } = useConfirm();

  async function handleDropIndex(indexName: string) {
    const ok = await confirm({
      title: `Drop index "${indexName}"?`,
      description: `DROP INDEX ${JSON.stringify(schema)}.${JSON.stringify(indexName)}`,
      danger: true,
    });
    if (!ok) return;
    dropIndex.mutate({ schema, table, index: indexName });
  }

  if (isLoading) {
    return <p className="px-lg py-md text-sm text-text-faint">Loading structure…</p>;
  }

  if (isError) {
    return <p className="px-lg py-md text-sm text-danger">Failed to load table structure.</p>;
  }

  if (!data) return null;

  return (
    <>
      {confirmDialog}
      <AddColumnModal
        open={addColumnOpen}
        onClose={() => setAddColumnOpen(false)}
        connectionId={connectionId}
        schema={schema}
        table={table}
      />
      <EditColumnModal
        open={editingColumn !== null}
        onClose={() => setEditingColumn(null)}
        col={editingColumn}
        connectionId={connectionId}
        schema={schema}
        table={table}
      />
      <CreateIndexModal
        open={createIndexOpen}
        onClose={() => setCreateIndexOpen(false)}
        connectionId={connectionId}
        schema={schema}
        table={table}
        availableColumns={data.columns}
      />

      <div className="h-full space-y-lg overflow-y-auto p-lg">
        <section>
          <div className="mb-sm flex items-center justify-between">
            <h2 className="text-xs font-medium uppercase tracking-wider text-text-faint">
              Columns ({data.columns.length})
            </h2>
            {writable ? (
              <Button variant="ghost" size="sm" onClick={() => setAddColumnOpen(true)}>
                <Plus size={13} />
                Add column
              </Button>
            ) : null}
          </div>
          <div className="overflow-hidden rounded-md border border-border">
            {data.columns.map((col, i) => (
              <div
                key={col.name}
                className={`group flex items-center gap-sm px-md py-sm text-sm ${i < data.columns.length - 1 ? 'border-b border-border' : ''}`}
              >
                <span className="min-w-0 flex-1 font-medium text-text">{col.name}</span>
                <ColumnTypePill dataType={col.dataType} />
                {col.isPrimaryKey ? <Badge variant="accent">PK</Badge> : null}
                {!col.nullable && !col.isPrimaryKey ? <Badge variant="neutral">NOT NULL</Badge> : null}
                {writable ? (
                  <IconButton
                    aria-label={`Edit column ${col.name}`}
                    onClick={() => setEditingColumn(col)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity max-md:opacity-100"
                  >
                    <Pencil size={13} />
                  </IconButton>
                ) : null}
              </div>
            ))}
          </div>
        </section>

        <section>
          <div className="mb-sm flex items-center justify-between">
            <h2 className="text-xs font-medium uppercase tracking-wider text-text-faint">
              Indexes ({data.indexes.length})
            </h2>
            {writable ? (
              <Button variant="ghost" size="sm" onClick={() => setCreateIndexOpen(true)}>
                <Plus size={13} />
                Add index
              </Button>
            ) : null}
          </div>
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
                    <span className="flex-1 font-medium text-text">{idx.name}</span>
                    {idx.isPrimary ? <Badge variant="accent">Primary</Badge> : null}
                    {idx.isUnique && !idx.isPrimary ? <Badge variant="success">Unique</Badge> : null}
                    <span className="text-xs text-text-faint">{idx.method}</span>
                    {writable && !idx.isPrimary ? (
                      <IconButton
                        aria-label={`Drop index ${idx.name}`}
                        onClick={() => void handleDropIndex(idx.name)}
                        disabled={dropIndex.isPending}
                      >
                        <Trash2 size={13} />
                      </IconButton>
                    ) : null}
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
    </>
  );
}
