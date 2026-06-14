import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { quoteIdent } from '@prost/utils';
import type { ColumnMetadata } from '@prost/shared-types';
import { Button, Checkbox, IconButton, Input, Surface } from '@prost/ui';
import { useAlterTable } from '../api/ddl';
import { useConfirm } from '../hooks/useConfirm';
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
  col: ColumnMetadata | null;
  connectionId: string;
  schema: string;
  table: string;
}

export function EditColumnModal({ open, onClose, col, connectionId, schema, table }: Props) {
  const [newType, setNewType] = useState('text');
  const [usingExpr, setUsingExpr] = useState('');
  const [nullable, setNullable] = useState(true);
  const [defaultVal, setDefaultVal] = useState('');
  const [typeError, setTypeError] = useState<string | null>(null);
  const [nullError, setNullError] = useState<string | null>(null);
  const [defaultError, setDefaultError] = useState<string | null>(null);
  const [dropError, setDropError] = useState<string | null>(null);

  const alter = useAlterTable(connectionId, schema, table);
  const { confirm, dialog } = useConfirm();

  useEffect(() => {
    if (open && col) {
      setNewType(col.dataType);
      setUsingExpr('');
      setNullable(col.nullable);
      setDefaultVal('');
      setTypeError(null); setNullError(null); setDefaultError(null); setDropError(null);
      alter.reset();
    }
  }, [open, col?.name]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !col) return null;
  const c = col;

  const q = (s: string) => quoteIdent(s);
  const tableRef = `${q(schema)}.${q(table)}`;
  const colRef = q(c.name);

  function typePreview() {
    if (!newType) return '';
    let sql = `ALTER TABLE ${tableRef} ALTER COLUMN ${colRef} TYPE ${newType}`;
    if (usingExpr.trim()) sql += ` USING ${usingExpr.trim()}`;
    return sql;
  }

  function nullPreview() {
    return `ALTER TABLE ${tableRef} ALTER COLUMN ${colRef} ${nullable ? 'DROP' : 'SET'} NOT NULL`;
  }

  function defaultPreview(drop: boolean) {
    if (drop) return `ALTER TABLE ${tableRef} ALTER COLUMN ${colRef} DROP DEFAULT`;
    return `ALTER TABLE ${tableRef} ALTER COLUMN ${colRef} SET DEFAULT ${defaultVal.trim() || '…'}`;
  }

  function applyType() {
    setTypeError(null);
    alter.mutate(
      { kind: 'changeType', columnName: c.name, type: newType, using: usingExpr.trim() || undefined },
      {
        onSuccess: () => onClose(),
        onError: (err) => setTypeError(apiErrorDetail(err, 'Failed to change type.')),
      },
    );
  }

  function applyNullable() {
    setNullError(null);
    alter.mutate(
      { kind: 'setNotNull', columnName: c.name, notNull: !nullable },
      {
        onSuccess: () => onClose(),
        onError: (err) => setNullError(apiErrorDetail(err, 'Failed to change nullability.')),
      },
    );
  }

  function applySetDefault() {
    if (!defaultVal.trim()) { setDefaultError('Enter a default value.'); return; }
    setDefaultError(null);
    alter.mutate(
      { kind: 'setDefault', columnName: c.name, default: defaultVal.trim() },
      {
        onSuccess: () => onClose(),
        onError: (err) => setDefaultError(apiErrorDetail(err, 'Failed to set default.')),
      },
    );
  }

  function applyDropDefault() {
    setDefaultError(null);
    alter.mutate(
      { kind: 'setDefault', columnName: c.name, default: null },
      {
        onSuccess: () => onClose(),
        onError: (err) => setDefaultError(apiErrorDetail(err, 'Failed to drop default.')),
      },
    );
  }

  async function handleDrop() {
    const sql = `ALTER TABLE ${tableRef} DROP COLUMN ${colRef}`;
    const ok = await confirm({
      title: `Drop column "${c.name}"?`,
      description: `This permanently removes the column and all its data.\n\n${sql}`,
      danger: true,
    });
    if (!ok) return;
    setDropError(null);
    alter.mutate(
      { kind: 'dropColumn', columnName: c.name },
      {
        onSuccess: () => onClose(),
        onError: (err) => setDropError(apiErrorDetail(err, 'Failed to drop column.')),
      },
    );
  }

  return (
    <>
      {dialog}
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-md md:items-center" onClick={onClose}>
        <Surface
          level="overlay"
          bordered
          onClick={(e) => e.stopPropagation()}
          className="flex w-full max-w-lg flex-col overflow-hidden rounded-lg shadow-2xl"
        >
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-lg">
            <span className="text-sm font-semibold text-text">Edit column <span className="font-mono">{c.name}</span></span>
            <IconButton aria-label="Close" onClick={onClose}><X size={16} /></IconButton>
          </div>

          <div className="flex flex-col gap-0 overflow-y-auto divide-y divide-border">
            {/* Change type */}
            <div className="flex flex-col gap-sm p-lg">
              <span className="text-xs font-medium uppercase tracking-wider text-text-faint">Change type</span>
              <div className="flex items-end gap-sm">
                <div className="flex-1">
                  <select
                    value={newType}
                    onChange={(e) => setNewType(e.target.value)}
                    className="h-9 w-full rounded-sm border border-border bg-surface px-sm text-xs font-mono text-text focus:border-accent focus:outline-none"
                  >
                    {ALLOWED_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <Button variant="secondary" size="sm" onClick={applyType} disabled={alter.isPending}>Change type</Button>
              </div>
              <div>
                <Input
                  value={usingExpr}
                  onChange={(e) => setUsingExpr(e.target.value)}
                  placeholder="USING expr — e.g. col_name::integer (optional)"
                  className="font-mono text-xs"
                />
              </div>
              <pre className="overflow-x-auto rounded-sm border border-border bg-surface-sunken p-sm font-mono text-xs text-text-faint">{typePreview()}</pre>
              {typeError ? <p className="text-xs text-danger" role="alert">{typeError}</p> : null}
            </div>

            {/* Nullability */}
            <div className="flex flex-col gap-sm p-lg">
              <span className="text-xs font-medium uppercase tracking-wider text-text-faint">Nullability</span>
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-sm text-sm text-text">
                  <Checkbox
                    checked={nullable}
                    disabled={c.isPrimaryKey}
                    onChange={(e) => setNullable(e.target.checked)}
                    aria-label="Nullable"
                  />
                  Allow NULL
                </label>
                <Button variant="secondary" size="sm" onClick={applyNullable} disabled={alter.isPending || c.isPrimaryKey}>
                  Apply
                </Button>
              </div>
              <pre className="overflow-x-auto rounded-sm border border-border bg-surface-sunken p-sm font-mono text-xs text-text-faint">{nullPreview()}</pre>
              {nullError ? <p className="text-xs text-danger" role="alert">{nullError}</p> : null}
            </div>

            {/* Default */}
            <div className="flex flex-col gap-sm p-lg">
              <span className="text-xs font-medium uppercase tracking-wider text-text-faint">Default value</span>
              <div className="flex items-center gap-sm">
                <Input
                  value={defaultVal}
                  onChange={(e) => setDefaultVal(e.target.value)}
                  placeholder="now(), 0, true…"
                  className="flex-1 font-mono text-xs"
                />
                <Button variant="secondary" size="sm" onClick={applySetDefault} disabled={alter.isPending}>Set</Button>
                <Button variant="ghost" size="sm" onClick={applyDropDefault} disabled={alter.isPending}>Clear</Button>
              </div>
              <pre className="overflow-x-auto rounded-sm border border-border bg-surface-sunken p-sm font-mono text-xs text-text-faint">
                {defaultPreview(!defaultVal.trim())}
              </pre>
              {defaultError ? <p className="text-xs text-danger" role="alert">{defaultError}</p> : null}
            </div>

            {/* Drop column */}
            {!c.isPrimaryKey ? (
              <div className="flex flex-col gap-sm p-lg">
                <span className="text-xs font-medium uppercase tracking-wider text-text-faint">Danger zone</span>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-text">Drop this column and all its data</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleDrop()}
                    disabled={alter.isPending}
                    className="text-danger hover:bg-danger/10"
                  >
                    Drop column
                  </Button>
                </div>
                {dropError ? <p className="text-xs text-danger" role="alert">{dropError}</p> : null}
              </div>
            ) : null}
          </div>

          <Surface level="raised" className="flex h-12 shrink-0 items-center justify-end border-t border-border px-lg">
            <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
          </Surface>
        </Surface>
      </div>
    </>
  );
}
