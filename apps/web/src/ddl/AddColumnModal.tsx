import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Button, Checkbox, IconButton, Input, Surface } from '@prost/ui';
import { useEngineDescriptor } from '../api/databaseEngines';
import { useAlterTable } from '../api/ddl';
import { useDdlPreview } from '../api/ddlPreview';
import { FormField } from '../components/FormField';
import { apiErrorDetail } from '../lib/apiClient';

const FALLBACK_PG_TYPES = [
  'integer', 'bigint', 'smallint', 'serial', 'bigserial',
  'boolean', 'text', 'varchar', 'varchar(255)', 'varchar(64)',
  'char(1)', 'real', 'double precision', 'numeric', 'numeric(10,2)',
  'date', 'time', 'timestamp', 'timestamptz', 'uuid',
  'json', 'jsonb', 'bytea',
];

interface Props {
  open: boolean;
  onClose: () => void;
  connectionId: string;
  schema: string;
  table: string;
}

export function AddColumnModal({ open, onClose, connectionId, schema, table }: Props) {
  const [name, setName] = useState('');
  const [type, setType] = useState('text');
  const [nullable, setNullable] = useState(true);
  const [isPrimaryKey, setIsPrimaryKey] = useState(false);
  const [autoIncrement, setAutoIncrement] = useState(false);
  const [defaultVal, setDefaultVal] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const descriptor = useEngineDescriptor(connectionId);
  const alter = useAlterTable(connectionId, schema, table);
  const columnTypes = descriptor?.ddl.columnTypes ?? FALLBACK_PG_TYPES;
  const effectiveNullable = isPrimaryKey ? false : nullable;
  const previewBody = name.trim() && type
    ? {
        kind: 'alterTable',
        request: {
          kind: 'addColumn',
          schema,
          table,
          column: {
            name: name.trim(),
            type,
            nullable: effectiveNullable,
            isPrimaryKey,
            autoIncrement,
            default: defaultVal.trim() || undefined,
          },
        },
      }
    : null;
  const { sql: previewSql } = useDdlPreview(connectionId, previewBody);

  useEffect(() => {
    if (!open) {
      setName(''); setType('text'); setNullable(true); setIsPrimaryKey(false);
      setAutoIncrement(false); setDefaultVal(''); setFormError(null); alter.reset();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  function handleSubmit() {
    if (!name.trim()) { setFormError('Column name is required.'); return; }
    setFormError(null);
    alter.mutate(
      {
        kind: 'addColumn',
        column: {
          name: name.trim(),
          type,
          nullable: effectiveNullable,
          isPrimaryKey,
          autoIncrement,
          default: defaultVal.trim() || undefined,
        },
      },
      {
        onSuccess: () => onClose(),
        onError: (err) => setFormError(apiErrorDetail(err, 'Failed to add column.')),
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
          <span className="text-sm font-semibold text-text">Add Column — {schema}.{table}</span>
          <IconButton aria-label="Close" onClick={onClose}><X size={16} /></IconButton>
        </div>

        <div className="flex flex-col gap-lg overflow-y-auto p-lg">
          <div className="grid grid-cols-2 gap-md">
            <FormField label="Name">
              <Input value={name} onChange={(e) => { setName(e.target.value); setFormError(null); }} placeholder="column_name" className="font-mono" />
            </FormField>
            <FormField label="Type">
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="h-9 w-full rounded-sm border border-border bg-surface px-sm text-xs font-mono text-text focus:border-accent focus:outline-none"
              >
                {columnTypes.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </FormField>
          </div>

          <div className="flex flex-wrap gap-lg">
            <label className="flex items-center gap-sm text-sm text-text">
              <Checkbox checked={isPrimaryKey} onChange={(e) => setIsPrimaryKey(e.target.checked)} aria-label="Primary key" />
              Primary key
            </label>
            <label className="flex items-center gap-sm text-sm text-text">
              <Checkbox checked={effectiveNullable} disabled={isPrimaryKey} onChange={(e) => setNullable(e.target.checked)} aria-label="Nullable" />
              Nullable
            </label>
            {descriptor?.ddl.supportsAutoIncrement ? (
              <label className="flex items-center gap-sm text-sm text-text">
                <Checkbox
                  checked={autoIncrement}
                  onChange={(e) => setAutoIncrement(e.target.checked)}
                  aria-label="Auto-increment"
                />
                Auto-increment
              </label>
            ) : null}
          </div>

          <FormField label="Default (optional)">
            <Input value={defaultVal} onChange={(e) => setDefaultVal(e.target.value)} placeholder="now(), 0, true…" className="font-mono text-xs" />
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
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={alter.isPending}>
            {alter.isPending ? 'Adding…' : 'Add Column'}
          </Button>
        </Surface>
      </Surface>
    </div>
  );
}
