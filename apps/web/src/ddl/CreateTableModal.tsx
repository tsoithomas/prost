import { useEffect, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { quoteIdent } from '@prost/utils';
import { Button, Checkbox, IconButton, Input, Surface } from '@prost/ui';
import { useCreateTable } from '../api/ddl';
import { FormField } from '../components/FormField';
import { apiErrorDetail } from '../lib/apiClient';

const ALLOWED_TYPES = [
  'integer', 'bigint', 'smallint', 'serial', 'bigserial',
  'boolean', 'text', 'varchar', 'varchar(255)', 'varchar(64)',
  'char(1)', 'real', 'double precision', 'numeric', 'numeric(10,2)',
  'date', 'time', 'timestamp', 'timestamptz', 'uuid',
  'json', 'jsonb', 'bytea',
];

interface ColumnRow {
  id: string;
  name: string;
  type: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  default: string;
}

function newRow(): ColumnRow {
  return { id: crypto.randomUUID(), name: '', type: 'text', nullable: true, isPrimaryKey: false, default: '' };
}

function buildPreviewSql(schema: string, table: string, columns: ColumnRow[]): string {
  if (!schema || !table || columns.length === 0) return '';
  const pkCols = columns.filter((c) => c.isPrimaryKey).map((c) => c.name).filter(Boolean);
  const colDefs = columns
    .filter((c) => c.name)
    .map((col) => {
      let def = `  ${quoteIdent(col.name)} ${col.type}`;
      if (!col.nullable) def += ' NOT NULL';
      if (col.default.trim()) def += ` DEFAULT ${col.default.trim()}`;
      return def;
    });
  if (pkCols.length > 0) colDefs.push(`  PRIMARY KEY (${pkCols.map(quoteIdent).join(', ')})`);
  if (colDefs.length === 0) return '';
  return `CREATE TABLE ${quoteIdent(schema)}.${quoteIdent(table)} (\n${colDefs.join(',\n')}\n)`;
}

export interface CreateTableModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (schema: string, table: string) => void;
  connectionId: string;
  initialSchema: string;
  schemas: string[];
}

export function CreateTableModal({
  open,
  onClose,
  onSuccess,
  connectionId,
  initialSchema,
  schemas,
}: CreateTableModalProps) {
  const [schema, setSchema] = useState(initialSchema);
  const [tableName, setTableName] = useState('');
  const [columns, setColumns] = useState<ColumnRow[]>([newRow()]);
  const [formError, setFormError] = useState<string | null>(null);

  const createTable = useCreateTable(connectionId);

  useEffect(() => {
    if (!open) {
      setSchema(initialSchema);
      setTableName('');
      setColumns([newRow()]);
      setFormError(null);
      createTable.reset();
    }
  }, [open]);

  useEffect(() => {
    if (open) setSchema(initialSchema);
  }, [initialSchema, open]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  function updateColumn(id: string, patch: Partial<ColumnRow>) {
    setColumns((prev) =>
      prev.map((col) => {
        if (col.id !== id) return col;
        const updated = { ...col, ...patch };
        if (patch.isPrimaryKey && patch.isPrimaryKey === true) updated.nullable = false;
        return updated;
      }),
    );
    setFormError(null);
  }

  function addColumn() {
    setColumns((prev) => [...prev, newRow()]);
  }

  function removeColumn(id: string) {
    setColumns((prev) => prev.filter((c) => c.id !== id));
  }

  function validate(): string | null {
    if (!tableName.trim()) return 'Table name is required.';
    const named = columns.filter((c) => c.name.trim());
    if (named.length === 0) return 'At least one column with a name is required.';
    const names = named.map((c) => c.name.trim());
    const dup = names.find((n, i) => names.indexOf(n) !== i);
    if (dup) return `Duplicate column name: "${dup}"`;
    return null;
  }

  function handleSubmit() {
    const error = validate();
    if (error) {
      setFormError(error);
      return;
    }
    setFormError(null);
    createTable.mutate(
      {
        schema,
        table: tableName.trim(),
        columns: columns
          .filter((c) => c.name.trim())
          .map((c) => ({
            name: c.name.trim(),
            type: c.type,
            nullable: c.nullable,
            isPrimaryKey: c.isPrimaryKey,
            default: c.default.trim() || undefined,
          })),
      },
      {
        onSuccess: () => {
          onSuccess(schema, tableName.trim());
          onClose();
        },
        onError: (err) => setFormError(apiErrorDetail(err, 'Failed to create table.')),
      },
    );
  }

  const previewSql = buildPreviewSql(schema, tableName, columns);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-md md:items-center" onClick={onClose}>
      <Surface
        level="overlay"
        bordered
        onClick={(e) => e.stopPropagation()}
        className="flex h-[min(680px,90vh)] w-full max-w-2xl flex-col overflow-hidden rounded-lg shadow-2xl"
      >
        {/* Header */}
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-lg">
          <span className="text-sm font-semibold text-text">New Table</span>
          <IconButton aria-label="Close" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>

        {/* Body */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-lg gap-lg">
          {/* Schema + table name */}
          <div className="grid grid-cols-2 gap-md">
            <FormField label="Schema">
              <select
                value={schema}
                onChange={(e) => setSchema(e.target.value)}
                className="h-9 rounded-sm border border-border bg-surface px-sm text-sm text-text focus:border-accent focus:outline-none"
              >
                {schemas.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Table name">
              <Input
                value={tableName}
                onChange={(e) => { setTableName(e.target.value); setFormError(null); }}
                placeholder="my_table"
                className="font-mono"
              />
            </FormField>
          </div>

          {/* Column editor */}
          <div>
            <div className="mb-sm flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wider text-text-faint">Columns</span>
              <Button type="button" variant="ghost" size="sm" onClick={addColumn}>
                <Plus size={13} />
                Add column
              </Button>
            </div>

            {/* Desktop column header */}
            <div className="hidden md:grid md:grid-cols-[1fr_1fr_auto_auto_1fr_auto] md:gap-x-sm md:mb-xs md:px-sm">
              {['Name', 'Type', 'PK', 'Null', 'Default', ''].map((h) => (
                <span key={h} className="text-xs font-medium text-text-faint">{h}</span>
              ))}
            </div>

            <div className="space-y-sm">
              {columns.map((col) => (
                <div
                  key={col.id}
                  className="rounded-sm border border-border p-sm md:border-0 md:p-0 md:grid md:grid-cols-[1fr_1fr_auto_auto_1fr_auto] md:items-center md:gap-x-sm"
                >
                  {/* Name */}
                  <div className="mb-xs md:mb-0">
                    <span className="block text-xs text-text-faint md:hidden">Name</span>
                    <Input
                      value={col.name}
                      onChange={(e) => updateColumn(col.id, { name: e.target.value })}
                      placeholder="column_name"
                      className="font-mono text-xs"
                    />
                  </div>

                  {/* Type */}
                  <div className="mb-xs md:mb-0">
                    <span className="block text-xs text-text-faint md:hidden">Type</span>
                    <select
                      value={col.type}
                      onChange={(e) => updateColumn(col.id, { type: e.target.value })}
                      className="h-9 w-full rounded-sm border border-border bg-surface px-sm text-xs font-mono text-text focus:border-accent focus:outline-none"
                    >
                      {ALLOWED_TYPES.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>

                  {/* PK */}
                  <div className="flex items-center gap-xs mb-xs md:mb-0 md:justify-center">
                    <span className="text-xs text-text-faint md:hidden">PK</span>
                    <Checkbox
                      checked={col.isPrimaryKey}
                      onChange={(e) => updateColumn(col.id, { isPrimaryKey: e.target.checked })}
                      aria-label="Primary key"
                    />
                  </div>

                  {/* Nullable */}
                  <div className="flex items-center gap-xs mb-xs md:mb-0 md:justify-center">
                    <span className="text-xs text-text-faint md:hidden">Nullable</span>
                    <Checkbox
                      checked={col.nullable}
                      disabled={col.isPrimaryKey}
                      onChange={(e) => updateColumn(col.id, { nullable: e.target.checked })}
                      aria-label="Nullable"
                    />
                  </div>

                  {/* Default */}
                  <div className="mb-xs md:mb-0">
                    <span className="block text-xs text-text-faint md:hidden">Default</span>
                    <Input
                      value={col.default}
                      onChange={(e) => updateColumn(col.id, { default: e.target.value })}
                      placeholder="now(), 0, true…"
                      className="font-mono text-xs"
                    />
                  </div>

                  {/* Remove */}
                  <IconButton
                    aria-label="Remove column"
                    disabled={columns.length <= 1}
                    onClick={() => removeColumn(col.id)}
                    className="ml-auto md:ml-0"
                  >
                    <Trash2 size={13} />
                  </IconButton>
                </div>
              ))}
            </div>
            <p className="mt-xs text-xs text-text-faint">
              Allowed defaults: <span className="font-mono">now()</span>,{' '}
              <span className="font-mono">gen_random_uuid()</span>,{' '}
              <span className="font-mono">true</span> / <span className="font-mono">false</span>,{' '}
              <span className="font-mono">null</span>, integers
            </p>
          </div>

          {/* SQL preview */}
          {previewSql ? (
            <div>
              <span className="mb-xs block text-xs font-medium uppercase tracking-wider text-text-faint">SQL Preview</span>
              <pre className="overflow-x-auto rounded-sm border border-border bg-surface-sunken p-md font-mono text-xs text-text">
                {previewSql}
              </pre>
            </div>
          ) : null}

          {/* Error */}
          {formError ? (
            <p className="text-xs text-danger" role="alert">{formError}</p>
          ) : null}
        </div>

        {/* Footer */}
        <Surface
          level="raised"
          className="flex h-16 shrink-0 items-center justify-end gap-md border-t border-border px-lg"
        >
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSubmit}
            disabled={createTable.isPending}
          >
            {createTable.isPending ? 'Creating…' : 'Create Table'}
          </Button>
        </Surface>
      </Surface>
    </div>
  );
}
