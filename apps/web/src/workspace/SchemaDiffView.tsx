import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { GitCompare, RefreshCw } from 'lucide-react';
import type {
  ColumnDiff,
  ColumnMetadata,
  DiffStatus,
  ForeignKeyDiff,
  ForeignKeyMetadata,
  IndexDiff,
  IndexMetadata,
  SchemaDiffChange,
  SchemaDiffChangeItem,
  TableDiff,
} from '@prost/shared-types';
import { Badge, Button, Checkbox, Toast } from '@prost/ui';
import { useConnection } from '../api/connections';
import { useGenerateMigration, useSchemaCompare } from '../api/schemaDiff';
import { useConfirm } from '../hooks/useConfirm';
import { useToasts } from '../hooks/useToasts';
import { apiErrorDetail, apiFetch } from '../lib/apiClient';
import { useDdlStore } from '../stores/ddlStore';

export interface SchemaDiffViewProps {
  connectionId: string;
  schema: string;
  compareConnectionId: string;
  compareSchema: string;
}

const STATUS_VARIANT: Record<DiffStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  added: 'success',
  changed: 'warning',
  removed: 'danger',
  unchanged: 'neutral',
};

function statusBadge(status: DiffStatus) {
  return (
    <Badge variant={STATUS_VARIANT[status]} className="shrink-0">
      {status}
    </Badge>
  );
}

function describeColumn(col: ColumnMetadata | null): string {
  if (!col) return '—';
  return `${col.dataType}${col.nullable ? '' : ' NOT NULL'}${col.defaultValue != null ? ` DEFAULT ${col.defaultValue}` : ''}`;
}

function describeIndex(idx: IndexMetadata | null): string {
  if (!idx) return '—';
  return `(${idx.columns.join(', ')})${idx.isUnique ? ' UNIQUE' : ''}`;
}

function describeForeignKey(fk: ForeignKeyMetadata | null): string {
  if (!fk) return '—';
  const target = `${fk.referencedSchema ? `${fk.referencedSchema}.` : ''}${fk.referencedTable}`;
  return `(${fk.columns.join(', ')}) → ${target}(${fk.referencedColumns.join(', ')})`;
}

function MemberDiffList<T extends { status: DiffStatus }>({
  title,
  items,
  keyOf,
  nameOf,
  describe,
}: {
  title: string;
  items: T[];
  keyOf: (item: T) => string;
  nameOf: (item: T) => string;
  describe: (item: T) => { before: string; after: string };
}) {
  const changed = items.filter((item) => item.status !== 'unchanged');
  if (changed.length === 0) return null;
  return (
    <div>
      <span className="text-xs font-medium uppercase tracking-wider text-text-faint">{title}</span>
      <ul className="mt-xs space-y-1">
        {changed.map((item) => {
          const { before, after } = describe(item);
          return (
            <li key={keyOf(item)} className="flex flex-wrap items-center gap-sm text-xs text-text-muted">
              {statusBadge(item.status)}
              <span className="font-mono text-text">{nameOf(item)}</span>
              <span className="font-mono text-text-faint">
                {before} → {after}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function changeLabel(change: SchemaDiffChange): string {
  if (change.kind === 'createTable') return `Create table ${change.request.schema}.${change.request.table}`;
  if (change.kind === 'dropTable') return `Drop table ${change.request.schema}.${change.request.table}`;
  if (change.kind === 'createIndex') {
    return `Create index on ${change.request.schema}.${change.request.table} (${change.request.columns.join(', ')})`;
  }
  if (change.kind === 'dropIndex') return `Drop index "${change.request.index}" on ${change.request.schema}.${change.request.table}`;

  const { schema, table, operation } = change.request;
  const verb: Record<string, string> = {
    addColumn: 'Add column',
    dropColumn: 'Drop column',
    setNotNull: 'Change nullability of',
    setDefault: 'Set default on',
    changeType: 'Change type of',
    addForeignKey: 'Add foreign key on',
    dropForeignKey: 'Drop foreign key on',
    setComment: 'Comment on',
  };
  const name =
    operation.kind === 'addColumn'
      ? operation.column.name
      : 'column' in operation
        ? operation.column
        : 'constraintName' in operation
          ? operation.constraintName
          : '';
  return `${verb[operation.kind]} ${schema}.${table}${name ? `.${name}` : ''}`;
}

/** Executes a destructive change directly (nothing to fill in — only confirm), reusing the existing DDL routes. */
async function applyDestructiveChange(change: SchemaDiffChange, targetConnectionId: string): Promise<void> {
  switch (change.kind) {
    case 'dropTable':
      await apiFetch(
        `/connections/${targetConnectionId}/ddl/tables/${encodeURIComponent(change.request.schema)}/${encodeURIComponent(change.request.table)}`,
        { method: 'DELETE' },
      );
      return;
    case 'dropIndex':
      await apiFetch(`/connections/${targetConnectionId}/ddl/indexes`, { method: 'DELETE', body: change.request });
      return;
    case 'alterTable': {
      const { schema, table, operation } = change.request;
      const url = `/connections/${targetConnectionId}/ddl/tables/${encodeURIComponent(schema)}/${encodeURIComponent(table)}`;
      if (operation.kind === 'dropColumn') {
        await apiFetch(url, { method: 'PATCH', body: { kind: 'dropColumn', columnName: operation.column } });
        return;
      }
      if (operation.kind === 'dropForeignKey') {
        await apiFetch(url, { method: 'PATCH', body: { kind: 'dropForeignKey', constraintName: operation.constraintName } });
        return;
      }
      throw new Error(`applyDestructiveChange called with a non-destructive alterTable operation: ${operation.kind}`);
    }
    default:
      throw new Error(`applyDestructiveChange called with a non-destructive change: ${change.kind}`);
  }
}

/**
 * Live-vs-live schema comparison + reconciling migration change-set (Phase 42) — a narrow sibling view,
 * never a forked grid (§5). Both sides are re-read on every compare; nothing is persisted (§1). Applying
 * a change routes through the *existing* DDL pipeline: editable changes (creates, in-place edits) open
 * the same modals `DdlSuggestionHost` uses for AI suggestions (Phase 33), pre-filled; destructive changes
 * (drops) have nothing to fill in, so they go straight to a danger `useConfirm` gate before executing
 * through the same DDL routes (§8). A change-set row must be checked *and* confirmed before it applies —
 * destructive rows start unchecked.
 */
export function SchemaDiffView({ connectionId, schema, compareConnectionId, compareSchema }: SchemaDiffViewProps) {
  const leftConnection = useConnection(connectionId);
  const rightConnection = useConnection(compareConnectionId);
  const compare = useSchemaCompare(connectionId, schema);
  const migration = useGenerateMigration(connectionId, schema);
  const openDdl = useDdlStore((state) => state.openDdl);
  const { confirm, dialog: confirmDialog } = useConfirm();
  const { toasts, push: pushToast, dismiss: dismissToast } = useToasts();
  const queryClient = useQueryClient();

  const [source, setSource] = useState<'left' | 'right'>('left');
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [applyingIndex, setApplyingIndex] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const right = { connectionId: compareConnectionId, schema: compareSchema };
  const targetRef = source === 'left' ? right : { connectionId, schema };

  useEffect(() => {
    compare.mutate(right);
    // Re-compare only when the pair being compared changes — `compare`/`right` are stable-enough for this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, schema, compareConnectionId, compareSchema]);

  function toggleExpanded(name: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function toggleChecked(index: number) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  async function handleGenerateMigration() {
    const result = await migration.mutateAsync({ right, source });
    const initial = new Set<number>();
    result.changes.forEach((item, i) => {
      if (!item.destructive) initial.add(i);
    });
    setChecked(initial);
  }

  async function applyItem(item: SchemaDiffChangeItem, index: number) {
    if (!item.destructive) {
      openDdl({ connectionId: targetRef.connectionId, schema: targetRef.schema, table: item.change.request.table, change: item.change });
      return;
    }
    const ok = await confirm({ title: 'Apply this change?', description: item.sql, confirmLabel: 'Apply', danger: true });
    if (!ok) return;
    setApplyingIndex(index);
    try {
      await applyDestructiveChange(item.change, targetRef.connectionId);
      pushToast('success', 'Change applied.');
      void queryClient.invalidateQueries({ queryKey: ['metadata', targetRef.connectionId] });
      void queryClient.invalidateQueries({
        queryKey: ['table-structure', targetRef.connectionId, item.change.request.schema, item.change.request.table],
      });
    } catch (err) {
      pushToast('danger', apiErrorDetail(err, 'Failed to apply change.'));
    } finally {
      setApplyingIndex(null);
    }
  }

  const diff = compare.data ?? null;
  const changedTables = diff ? diff.tables.filter((t) => t.status !== 'unchanged') : [];
  const unchangedCount = diff ? diff.tables.length - changedTables.length : 0;

  return (
    <>
      {confirmDialog}
      <div className="h-full space-y-lg overflow-auto p-lg">
        <header className="flex flex-wrap items-center gap-x-md gap-y-xs">
          <h2 className="flex items-center gap-sm text-sm font-medium text-text">
            <GitCompare size={15} className="text-accent" />
            <span className="font-mono">
              {leftConnection?.name ?? connectionId}.{schema}
            </span>
            <span className="text-text-faint">vs</span>
            <span className="font-mono">
              {rightConnection?.name ?? compareConnectionId}.{compareSchema}
            </span>
          </h2>
          <Button variant="secondary" size="sm" className="ml-auto" onClick={() => compare.mutate(right)} disabled={compare.isPending}>
            <RefreshCw size={13} />
            {compare.isPending ? 'Comparing…' : 'Refresh'}
          </Button>
        </header>

        {compare.isError ? <p className="text-sm text-danger">{apiErrorDetail(compare.error, 'Failed to compare schemas.')}</p> : null}

        {diff ? (
          <section className="space-y-sm">
            <p className="text-xs text-text-faint">
              {changedTables.length} {changedTables.length === 1 ? 'table differs' : 'tables differ'}
              {unchangedCount > 0 ? ` · ${unchangedCount} unchanged` : ''}
            </p>
            {changedTables.length === 0 ? (
              <p className="text-sm italic text-text-faint">Schemas are identical.</p>
            ) : (
              <div className="overflow-hidden rounded-md border border-border">
                {changedTables.map((table: TableDiff, i) => (
                  <div key={table.name} className={i < changedTables.length - 1 ? 'border-b border-border' : ''}>
                    <button
                      type="button"
                      onClick={() => toggleExpanded(table.name)}
                      className="flex w-full items-center gap-sm px-md py-sm text-left hover:bg-surface-hover"
                    >
                      {statusBadge(table.status)}
                      <span className="font-mono text-sm text-text">{table.name}</span>
                    </button>
                    {expanded.has(table.name) ? (
                      <div className="space-y-sm border-t border-border bg-surface-sunken px-md py-sm">
                        <MemberDiffList<ColumnDiff>
                          title="Columns"
                          items={table.columns}
                          keyOf={(c) => c.name}
                          nameOf={(c) => c.name}
                          describe={(c) => ({ before: describeColumn(c.left), after: describeColumn(c.right) })}
                        />
                        <MemberDiffList<IndexDiff>
                          title="Indexes"
                          items={table.indexes}
                          keyOf={(idx) => idx.name}
                          nameOf={(idx) => idx.name}
                          describe={(idx) => ({ before: describeIndex(idx.left), after: describeIndex(idx.right) })}
                        />
                        <MemberDiffList<ForeignKeyDiff>
                          title="Foreign keys"
                          items={table.foreignKeys}
                          keyOf={(fk) => fk.constraintName}
                          nameOf={(fk) => fk.constraintName}
                          describe={(fk) => ({ before: describeForeignKey(fk.left), after: describeForeignKey(fk.right) })}
                        />
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </section>
        ) : null}

        {diff ? (
          <section className="space-y-sm">
            <div className="flex flex-wrap items-center gap-md">
              <span className="text-xs font-medium uppercase tracking-wider text-text-faint">Source of truth</span>
              <label className="flex items-center gap-xs text-sm text-text">
                <input type="radio" name="schema-diff-source" checked={source === 'left'} onChange={() => setSource('left')} />
                {schema} ({leftConnection?.name ?? connectionId})
              </label>
              <label className="flex items-center gap-xs text-sm text-text">
                <input type="radio" name="schema-diff-source" checked={source === 'right'} onChange={() => setSource('right')} />
                {compareSchema} ({rightConnection?.name ?? compareConnectionId})
              </label>
              <Button variant="secondary" size="sm" onClick={() => void handleGenerateMigration()} disabled={migration.isPending}>
                {migration.isPending ? 'Generating…' : 'Generate migration'}
              </Button>
            </div>

            {migration.isError ? (
              <p className="text-sm text-danger">{apiErrorDetail(migration.error, 'Failed to generate migration.')}</p>
            ) : null}

            {migration.data ? (
              migration.data.changes.length === 0 ? (
                <p className="text-sm italic text-text-faint">No reconciling changes — already in sync from this direction.</p>
              ) : (
                <div className="flex flex-col gap-sm">
                  {migration.data.changes.map((item, i) => (
                    <div key={i} className="flex flex-col gap-sm rounded-md border border-border bg-surface-raised p-md">
                      <div className="flex items-start gap-sm">
                        <Checkbox
                          checked={checked.has(i)}
                          onChange={() => toggleChecked(i)}
                          aria-label={`Include: ${changeLabel(item.change)}`}
                        />
                        <span className="text-sm font-medium text-text">{changeLabel(item.change)}</span>
                        {item.destructive ? <Badge variant="danger">destructive</Badge> : null}
                      </div>
                      <pre className="overflow-x-auto rounded-sm border border-border bg-surface-sunken p-md font-mono text-xs text-text">
                        {item.sql}
                      </pre>
                      <div className="flex justify-end">
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={!checked.has(i) || applyingIndex === i}
                          onClick={() => void applyItem(item, i)}
                        >
                          {applyingIndex === i ? 'Applying…' : item.destructive ? 'Apply' : 'Review'}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )
            ) : null}
          </section>
        ) : null}
      </div>

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-sm p-md sm:items-end">
        {toasts.map((toast) => (
          <div key={toast.id} className="pointer-events-auto w-full max-w-[24rem]">
            <Toast variant={toast.variant} message={toast.message} onDismiss={() => dismissToast(toast.id)} />
          </div>
        ))}
      </div>
    </>
  );
}
