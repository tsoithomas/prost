import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { ColumnMetadata } from '@prost/shared-types';
import { Button, Checkbox, IconButton, Input, Surface } from '@prost/ui';
import { useEngineDescriptor } from '../api/databaseEngines';
import { useCreateIndex } from '../api/ddl';
import { useDdlPreview } from '../api/ddlPreview';
import { FormField } from '../components/FormField';
import { apiErrorDetail } from '../lib/apiClient';

interface Props {
  open: boolean;
  onClose: () => void;
  connectionId: string;
  schema: string;
  table: string;
  availableColumns: ColumnMetadata[];
}

export function CreateIndexModal({ open, onClose, connectionId, schema, table, availableColumns }: Props) {
  const [selectedCols, setSelectedCols] = useState<string[]>([]);
  const [unique, setUnique] = useState(false);
  const [method, setMethod] = useState('btree');
  const [indexName, setIndexName] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const descriptor = useEngineDescriptor(connectionId);
  const createIndex = useCreateIndex(connectionId, schema, table);
  const indexMethods = descriptor?.ddl.indexMethods ?? ['btree'];
  const previewBody = selectedCols.length > 0
    ? {
        kind: 'createIndex',
        request: {
          schema,
          table,
          columns: selectedCols,
          unique,
          method,
          name: indexName.trim() || undefined,
        },
      }
    : null;
  const { sql: previewSql } = useDdlPreview(connectionId, previewBody);

  useEffect(() => {
    if (!open) {
      setSelectedCols([]); setUnique(false); setMethod('btree');
      setIndexName(''); setFormError(null); createIndex.reset();
    }
  }, [open]);

  useEffect(() => {
    if (indexMethods.length > 0 && !indexMethods.includes(method)) {
      setMethod(indexMethods[0]!);
    }
  }, [indexMethods, method]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  function toggleCol(name: string) {
    setSelectedCols((prev) => prev.includes(name) ? prev.filter((c) => c !== name) : [...prev, name]);
    setFormError(null);
  }

  function handleSubmit() {
    if (selectedCols.length === 0) { setFormError('Select at least one column.'); return; }
    setFormError(null);
    createIndex.mutate(
      { schema, table, columns: selectedCols, unique, method, name: indexName.trim() || undefined },
      {
        onSuccess: () => onClose(),
        onError: (err) => setFormError(apiErrorDetail(err, 'Failed to create index.')),
      },
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-md md:items-center">
      <Surface
        level="overlay"
        bordered
        className="flex w-full max-w-[32rem] flex-col overflow-hidden rounded-lg shadow-2xl"
      >
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-lg">
          <span className="text-sm font-semibold text-text">Add Index — {schema}.{table}</span>
          <IconButton aria-label="Close" onClick={onClose}><X size={16} /></IconButton>
        </div>

        <div className="flex flex-col gap-lg overflow-y-auto p-lg">
          <div>
            <span className="mb-sm block text-xs font-medium uppercase tracking-wider text-text-faint">Columns</span>
            <div className="overflow-hidden rounded-md border border-border">
              {availableColumns.map((col, i) => (
                <label
                  key={col.name}
                  className={`flex cursor-pointer items-center gap-sm px-md py-sm text-sm text-text hover:bg-surface-raised ${i < availableColumns.length - 1 ? 'border-b border-border' : ''}`}
                >
                  <Checkbox
                    checked={selectedCols.includes(col.name)}
                    onChange={() => toggleCol(col.name)}
                    aria-label={col.name}
                  />
                  <span className="font-medium">{col.name}</span>
                  <span className="ml-auto font-mono text-xs text-text-faint">{col.dataType}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-lg">
            <label className="flex items-center gap-sm text-sm text-text">
              <Checkbox checked={unique} onChange={(e) => setUnique(e.target.checked)} aria-label="Unique" />
              Unique
            </label>
            <FormField label="Method" className="flex-1">
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className="h-9 w-full rounded-sm border border-border bg-surface px-sm text-sm text-text focus:border-accent focus:outline-none"
              >
                {indexMethods.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </FormField>
          </div>

          <FormField label="Name (optional — auto-generated if blank)">
            <Input value={indexName} onChange={(e) => setIndexName(e.target.value)} placeholder={`${table}_col_idx`} className="font-mono text-xs" />
          </FormField>

          {previewSql ? (
            <div>
              <span className="mb-xs block text-xs font-medium uppercase tracking-wider text-text-faint">SQL Preview</span>
              <pre className="overflow-x-auto rounded-sm border border-border bg-surface-sunken p-md font-mono text-xs text-text">{previewSql}</pre>
            </div>
          ) : null}

          {formError ? <p className="text-xs text-danger" role="alert">{formError}</p> : null}
        </div>

        <Surface level="raised" className="flex h-16 shrink-0 items-center justify-end gap-md border-t border-border px-lg">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={createIndex.isPending}>
            {createIndex.isPending ? 'Creating…' : 'Create Index'}
          </Button>
        </Surface>
      </Surface>
    </div>
  );
}
