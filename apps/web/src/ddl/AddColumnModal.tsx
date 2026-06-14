import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { quoteIdent } from '@prost/utils';
import { Button, Checkbox, IconButton, Input, Surface } from '@prost/ui';
import { useAlterTable } from '../api/ddl';
import { FormField } from '../components/FormField';
import { apiErrorDetail } from '../lib/apiClient';

const ALLOWED_TYPES = [
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
  const [defaultVal, setDefaultVal] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const alter = useAlterTable(connectionId, schema, table);

  useEffect(() => {
    if (!open) {
      setName(''); setType('text'); setNullable(true); setIsPrimaryKey(false);
      setDefaultVal(''); setFormError(null); alter.reset();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const effectiveNullable = isPrimaryKey ? false : nullable;

  function previewSql() {
    if (!name.trim()) return '';
    let def = `  ${quoteIdent(name.trim())} ${type}`;
    if (isPrimaryKey) { def += ' PRIMARY KEY'; }
    else if (!effectiveNullable) { def += ' NOT NULL'; }
    if (defaultVal.trim()) def += ` DEFAULT ${defaultVal.trim()}`;
    return `ALTER TABLE ${quoteIdent(schema)}.${quoteIdent(table)} ADD COLUMN ${def}`;
  }

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
          default: defaultVal.trim() || undefined,
        },
      },
      {
        onSuccess: () => onClose(),
        onError: (err) => setFormError(apiErrorDetail(err, 'Failed to add column.')),
      },
    );
  }

  const preview = previewSql();

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
                {ALLOWED_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
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
          </div>

          <FormField label="Default (optional)">
            <Input value={defaultVal} onChange={(e) => setDefaultVal(e.target.value)} placeholder="now(), 0, true…" className="font-mono text-xs" />
          </FormField>

          {preview ? (
            <div>
              <span className="mb-xs block text-xs font-medium uppercase tracking-wider text-text-faint">SQL Preview</span>
              <pre className="overflow-x-auto rounded-sm border border-border bg-surface-sunken p-md font-mono text-xs text-text">{preview}</pre>
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
