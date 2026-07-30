import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { quoteIdent } from '@prost/utils';
import type { AlterTableOperation, ColumnMetadata } from '@prost/shared-types';
import { Button, Checkbox, IconButton, Input, Modal, Surface } from '@prost/ui';
import { useEngineDescriptor } from '../api/databaseEngines';
import { useAlterTable } from '../api/ddl';
import { useDdlPreview } from '../api/ddlPreview';
import { useConfirm } from '../hooks/useConfirm';
import { apiErrorDetail } from '../lib/apiClient';

const FALLBACK_PG_TYPES = [
  'integer', 'bigint', 'smallint', 'serial', 'bigserial',
  'boolean', 'text', 'varchar', 'varchar(255)', 'varchar(64)',
  'char(1)', 'real', 'double precision', 'numeric', 'numeric(10,2)',
  'date', 'time', 'timestamp', 'timestamptz', 'uuid',
  'json', 'jsonb', 'bytea',
];

/** The in-place column changes this modal can be pre-seeded with (Phase 33 — a subset of the DDL union). */
export type EditColumnSeed = Extract<
  AlterTableOperation,
  { kind: 'setNotNull' } | { kind: 'setDefault' } | { kind: 'changeType' }
>;

interface Props {
  open: boolean;
  onClose: () => void;
  col: ColumnMetadata | null;
  connectionId: string;
  schema: string;
  table: string;
  /** Seed + highlight one section when opened from outside (e.g. an AI suggestion — Phase 33). */
  initialOperation?: EditColumnSeed;
}

export function EditColumnModal({ open, onClose, col, connectionId, schema, table, initialOperation }: Props) {
  const [newType, setNewType] = useState('text');
  const [usingExpr, setUsingExpr] = useState('');
  const [nullable, setNullable] = useState(true);
  const [defaultVal, setDefaultVal] = useState('');
  const [typeError, setTypeError] = useState<string | null>(null);
  const [nullError, setNullError] = useState<string | null>(null);
  const [defaultError, setDefaultError] = useState<string | null>(null);
  const [dropError, setDropError] = useState<string | null>(null);

  const descriptor = useEngineDescriptor(connectionId);
  const alter = useAlterTable(connectionId, schema, table);
  const { confirm, dialog } = useConfirm();
  const columnTypes = descriptor?.ddl.columnTypes ?? FALLBACK_PG_TYPES;
  const supportsUsingExpression = descriptor?.ddl.supportsUsingExpression ?? true;
  const previewBody = col && newType
    ? {
        kind: 'alterTable',
        request: {
          kind: 'changeType',
          schema,
          table,
          columnName: col.name,
          type: newType,
          using: supportsUsingExpression && usingExpr.trim() ? usingExpr.trim() : undefined,
        },
      }
    : null;
  const { sql: previewSql } = useDdlPreview(connectionId, previewBody);

  // Seed from the column, then let `initialOperation` (an AI suggestion) override the one field it
  // targets. Keyed on the serialized operation — same idiom as `useDdlPreview` — so a caller
  // re-creating the object each render can't stomp the user's edits.
  const seedKey = JSON.stringify(initialOperation ?? null);
  useEffect(() => {
    if (!open || !col) return;
    const seed = JSON.parse(seedKey) as EditColumnSeed | null;
    setNewType(seed?.kind === 'changeType' ? seed.type : col.dataType);
    setUsingExpr(seed?.kind === 'changeType' ? seed.using ?? '' : '');
    setNullable(seed?.kind === 'setNotNull' ? !seed.notNull : col.nullable);
    setDefaultVal(seed?.kind === 'setDefault' ? seed.default ?? '' : '');
    setTypeError(null); setNullError(null); setDefaultError(null); setDropError(null);
    alter.reset();
  }, [open, col?.name, seedKey]);

  // Which section the suggestion targets, so the user's eye lands on it among the three.
  const suggested = initialOperation?.kind ?? null;
  const sectionClass = (kind: EditColumnSeed['kind']) =>
    `flex flex-col gap-sm p-lg${suggested === kind ? ' bg-accent-muted' : ''}`;

  if (!col) return null;
  const c = col;

  const q = (s: string) => quoteIdent(s);
  const tableRef = `${q(schema)}.${q(table)}`;
  const colRef = q(c.name);

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
      {
        kind: 'changeType',
        columnName: c.name,
        type: newType,
        using: supportsUsingExpression && usingExpr.trim() ? usingExpr.trim() : undefined,
      },
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
      <Modal open={open} onClose={onClose} title={`Edit column ${c.name}`} hideTitle className="w-full max-w-[32rem] overflow-hidden">
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-lg">
            <span className="text-sm font-semibold text-text">Edit column <span className="font-mono">{c.name}</span></span>
            <IconButton aria-label="Close" onClick={onClose}><X size={16} /></IconButton>
          </div>

          <div className="flex flex-col gap-0 overflow-y-auto divide-y divide-border">
            {/* Change type */}
            <div className={sectionClass('changeType')}>
              <span className="text-xs font-medium uppercase tracking-wider text-text-faint">Change type</span>
              <div className="flex items-end gap-sm">
                <div className="flex-1">
                  <select
                    value={newType}
                    onChange={(e) => setNewType(e.target.value)}
                    className="h-9 w-full rounded-sm border border-border bg-surface px-sm text-xs font-mono text-text focus:border-accent focus:outline-none"
                  >
                    {columnTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <Button variant="secondary" size="sm" onClick={applyType} disabled={alter.isPending}>Change type</Button>
              </div>
              {supportsUsingExpression ? (
                <div>
                  <Input
                    value={usingExpr}
                    onChange={(e) => setUsingExpr(e.target.value)}
                    placeholder="USING expr — e.g. col_name::integer (optional)"
                    className="font-mono text-xs"
                  />
                </div>
              ) : null}
              {previewSql ? (
                <pre className="overflow-x-auto rounded-sm border border-border bg-surface-sunken p-sm font-mono text-xs text-text-faint">{previewSql}</pre>
              ) : null}
              {typeError ? <p className="text-xs text-danger" role="alert">{typeError}</p> : null}
            </div>

            {/* Nullability */}
            <div className={sectionClass('setNotNull')}>
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
            <div className={sectionClass('setDefault')}>
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
      </Modal>
    </>
  );
}
