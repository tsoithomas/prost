import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import {
  Fingerprint,
  KeyRound,
  Link2,
  ListTree,
  MessageSquareText,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import type { ColumnMetadata, ForeignKeyMetadata, IndexMetadata } from '@prost/shared-types';
import { Badge, Button, IconButton, Modal, Tooltip } from '@prost/ui';
import { ColumnTypePill, splitTypeModifiers } from '../grid/columnDefs';
import { useEngineDescriptor } from '../api/databaseEngines';
import { useAlterTable, useDropIndex } from '../api/ddl';
import { AddColumnModal } from '../ddl/AddColumnModal';
import { AddForeignKeyModal } from '../ddl/AddForeignKeyModal';
import { CreateIndexModal } from '../ddl/CreateIndexModal';
import { EditColumnModal } from '../ddl/EditColumnModal';
import { EditCommentModal } from '../ddl/EditCommentModal';
import { useConfirm } from '../hooks/useConfirm';
import { useTableStructure } from '../api/metadata';
import { useWorkspaceStore } from '../stores/workspaceStore';

export interface TableStructurePanelProps {
  connectionId: string;
  schema: string;
  table: string;
  /** Read-only connections (the app DB) hide all DDL actions. */
  writable?: boolean;
}

/** Shared cell padding for every table in this panel, matching `DatabaseOverview`. */
const CELL = 'px-md py-sm align-top';
const HEAD = `${CELL} text-left font-medium whitespace-nowrap`;
/** Placeholder for a cell with nothing to report — keeps columns visually aligned. */
const DASH = <span className="text-text-faint">—</span>;

/** Renders `referencedSchema.referencedTable(a, b)` — the parent side of a foreign key. */
function referenceLabel(fk: ForeignKeyMetadata): string {
  return `${fk.referencedSchema ? `${fk.referencedSchema}.` : ''}${fk.referencedTable}(${fk.referencedColumns.join(', ')})`;
}

/**
 * The column this FK points at from `column`'s position — a composite FK maps its local columns
 * 1:1 onto the referenced ones, so the position matters.
 */
function referencedColumnFor(fk: ForeignKeyMetadata, column: string): string {
  return fk.referencedColumns[fk.columns.indexOf(column)] ?? fk.referencedColumns.join(', ');
}

/**
 * True when `idx` makes `column` itself unique. A composite unique index constrains the
 * *combination* of its columns, so it says nothing about any one of them — hence the length check.
 */
function marksColumnUnique(idx: IndexMetadata): boolean {
  return idx.isUnique && !idx.isPrimary && idx.columns.length === 1;
}

/** How many indexes the chip's tooltip names before falling back to a count. */
const INDEX_TOOLTIP_LIMIT = 3;

/**
 * Shared geometry for the Keys column's chips. Without a fixed height the icon-only chips would sit
 * shorter than the index one, whose height comes from its number's 16px line box rather than an
 * 11px glyph — 18px is what `Badge`'s own `text-xs` + `py-[1px]` produces. The index chip is still
 * wider than the other two, since it carries a count as well as an icon.
 */
const KEY_CHIP = 'h-[18px]';

/**
 * What kind of index this is, in the same colour + glyph language as the Keys column chips:
 * accent key = primary, green fingerprint = unique, grey list = plain index.
 */
function IndexKindBadge({ index }: { index: IndexMetadata }) {
  if (index.isPrimary) {
    return (
      <Badge variant="gold">
        <KeyRound size={11} aria-hidden />
        Primary
      </Badge>
    );
  }
  if (index.isUnique) {
    return (
      <Badge variant="success">
        <Fingerprint size={11} aria-hidden />
        Unique
      </Badge>
    );
  }
  return (
    <Badge variant="info">
      <ListTree size={11} aria-hidden />
      Index
    </Badge>
  );
}

/**
 * The index chip's hover summary: a count, then the first few indexes by name and columns.
 * Uniqueness is deliberately left out — the unique chip beside this one already carries it.
 */
function indexChipTooltip(indexes: IndexMetadata[]) {
  const named = indexes.slice(0, INDEX_TOOLTIP_LIMIT);
  return (
    <>
      <div className="font-medium">
        {indexes.length} {indexes.length === 1 ? 'index' : 'indexes'}
      </div>
      {named.map((idx) => (
        <div key={idx.name} className="text-text-muted">
          - {idx.name} ({idx.columns.join(', ')})
        </div>
      ))}
      {indexes.length > named.length ? (
        <div className="text-text-faint">... and {indexes.length - named.length} more</div>
      ) : null}
    </>
  );
}

export function TableStructurePanel({ connectionId, schema, table, writable = true }: TableStructurePanelProps) {
  const { data, isLoading, isError } = useTableStructure(connectionId, schema, table);

  const [addColumnOpen, setAddColumnOpen] = useState(false);
  const [editingColumn, setEditingColumn] = useState<ColumnMetadata | null>(null);
  const [createIndexOpen, setCreateIndexOpen] = useState(false);
  const [addForeignKeyOpen, setAddForeignKeyOpen] = useState(false);
  /** Which comment is being edited: the table's own (`{}`) or a column's. Null when closed. */
  const [commentTarget, setCommentTarget] = useState<{ column?: string } | null>(null);
  /** Which column's indexes are being listed in the read-only popup. Null when closed. */
  const [indexModalColumn, setIndexModalColumn] = useState<string | null>(null);
  /** A column comment being read in full — the table cell only shows one clipped line. */
  const [viewingComment, setViewingComment] = useState<{ column: string; comment: string } | null>(null);
  const [highlightedColumn, setHighlightedColumn] = useState<string | null>(null);
  const columnsRef = useRef<HTMLDivElement>(null);

  const descriptor = useEngineDescriptor(connectionId);
  const supportsForeignKeyDdl = descriptor?.ddl.supportsForeignKeyDdl ?? false;
  // Comments are a write, so they follow the same gate as the other DDL affordances — plus the
  // engine capability, since SQLite has no comment syntax at all.
  const canEditComments = writable && (descriptor?.ddl.supportsObjectComments ?? false);
  const dropIndex = useDropIndex(connectionId, schema, table);
  const alterTable = useAlterTable(connectionId, schema, table);
  const { confirm, dialog: confirmDialog } = useConfirm();

  const revealColumn = useWorkspaceStore((state) => state.revealColumn);
  const clearRevealColumn = useWorkspaceStore((state) => state.clearRevealColumn);
  const revealTableColumn = useWorkspaceStore((state) => state.revealTableColumn);

  // Index / FK membership is per-column information the payload only carries per-object, so invert
  // both once here rather than re-scanning them in every row.
  const indexesByColumn = useMemo(() => {
    const map = new Map<string, IndexMetadata[]>();
    for (const idx of data?.indexes ?? []) {
      // The primary index is already conveyed by the key icon — don't say it twice.
      if (idx.isPrimary) continue;
      for (const column of idx.columns) {
        map.set(column, [...(map.get(column) ?? []), idx]);
      }
    }
    return map;
  }, [data?.indexes]);

  const foreignKeysByColumn = useMemo(() => {
    const map = new Map<string, ForeignKeyMetadata[]>();
    for (const fk of data?.foreignKeys ?? []) {
      for (const column of fk.columns) {
        map.set(column, [...(map.get(column) ?? []), fk]);
      }
    }
    return map;
  }, [data?.foreignKeys]);

  // When global search asks to reveal a column in *this* table, scroll to it and briefly highlight.
  useEffect(() => {
    if (!data || !revealColumn || revealColumn.schema !== schema || revealColumn.table !== table) return;
    const target = revealColumn.column;
    clearRevealColumn();
    const node = columnsRef.current?.querySelector<HTMLElement>(`[data-column="${CSS.escape(target)}"]`);
    node?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightedColumn(target);
    const timer = setTimeout(() => setHighlightedColumn(null), 2000);
    return () => clearTimeout(timer);
  }, [data, revealColumn, schema, table, clearRevealColumn]);

  async function handleDropIndex(indexName: string) {
    const ok = await confirm({
      title: `Drop index "${indexName}"?`,
      description: `DROP INDEX ${JSON.stringify(schema)}.${JSON.stringify(indexName)}`,
      danger: true,
    });
    if (!ok) return;
    dropIndex.mutate({ schema, table, index: indexName });
  }

  async function handleDropForeignKey(constraintName: string) {
    const ok = await confirm({
      title: `Drop foreign key "${constraintName}"?`,
      description: `ALTER TABLE ${schema}.${table} DROP CONSTRAINT ${constraintName}`,
      danger: true,
    });
    if (!ok) return;
    alterTable.mutate({ kind: 'dropForeignKey', constraintName });
  }

  if (isLoading) {
    return <p className="px-lg py-md text-sm text-text-faint">Loading structure…</p>;
  }

  if (isError) {
    return <p className="px-lg py-md text-sm text-danger">Failed to load table structure.</p>;
  }

  if (!data) return null;

  const showColumnActions = canEditComments || writable;

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
      <AddForeignKeyModal
        open={addForeignKeyOpen}
        onClose={() => setAddForeignKeyOpen(false)}
        connectionId={connectionId}
        schema={schema}
        table={table}
        availableColumns={data.columns}
      />

      {/* Read-only detail for the Keys column's index chip — a column can sit in more indexes than
          a table cell has room to name. */}
      {indexModalColumn !== null ? (
        <Modal
          open
          onClose={() => setIndexModalColumn(null)}
          title={`Indexes on ${indexModalColumn}`}
          hideTitle
          className="w-full max-w-[32rem] overflow-hidden"
        >
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-lg">
            <h2 className="truncate text-sm font-semibold text-text">
              Indexes on <span className="font-mono">{indexModalColumn}</span>
            </h2>
            <IconButton aria-label="Close" onClick={() => setIndexModalColumn(null)}>
              <X size={16} />
            </IconButton>
          </div>
          <div className="max-h-[60vh] space-y-md overflow-y-auto p-lg">
            {(indexesByColumn.get(indexModalColumn) ?? []).map((idx) => (
              <div key={idx.name} className="space-y-xs">
                <div className="flex flex-wrap items-center gap-sm">
                  <span className="font-medium text-text">{idx.name}</span>
                  <IndexKindBadge index={idx} />
                  <span className="text-xs text-text-faint">{idx.method}</span>
                </div>
                <p className="font-mono text-xs text-text-muted">{idx.columns.join(', ')}</p>
                {idx.definition ? (
                  <code className="block overflow-x-auto whitespace-pre rounded-sm bg-surface-sunken p-sm text-xs text-text-faint">
                    {idx.definition}
                  </code>
                ) : null}
              </div>
            ))}
          </div>
        </Modal>
      ) : null}

      {/* The full text behind a clipped Comment cell. Read-only — editing is the pencil in the
          actions cell, which is gated on write access. */}
      {viewingComment ? (
        <Modal
          open
          onClose={() => setViewingComment(null)}
          title={`Comment on ${viewingComment.column}`}
          hideTitle
          className="w-full max-w-[32rem] overflow-hidden"
        >
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-lg">
            <h2 className="truncate text-sm font-semibold text-text">
              Comment on <span className="font-mono">{viewingComment.column}</span>
            </h2>
            <IconButton aria-label="Close" onClick={() => setViewingComment(null)}>
              <X size={16} />
            </IconButton>
          </div>
          <p className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap p-lg text-sm text-text">
            {viewingComment.comment}
          </p>
        </Modal>
      ) : null}

      {commentTarget ? (
        <EditCommentModal
          open
          onClose={() => setCommentTarget(null)}
          connectionId={connectionId}
          schema={schema}
          table={table}
          {...(commentTarget.column ? { column: commentTarget.column } : {})}
          current={
            commentTarget.column
              ? data.columns.find((c) => c.name === commentTarget.column)?.comment ?? null
              : data.comment
          }
        />
      ) : null}

      <div className="h-full space-y-lg overflow-y-auto p-lg">
        {/* The table's own documentation, read from the target DB (Phase 38). */}
        {data.comment !== null || canEditComments ? (
          <section>
            <div className="mb-sm flex items-center justify-between">
              <h2 className="text-xs font-medium uppercase tracking-wider text-text-faint">Comment</h2>
              {canEditComments ? (
                <Button variant="ghost" size="sm" onClick={() => setCommentTarget({})}>
                  <Pencil size={13} />
                  {data.comment === null ? 'Add comment' : 'Edit comment'}
                </Button>
              ) : null}
            </div>
            <p className={clsx('text-sm', data.comment === null ? 'italic text-text-faint' : 'text-text')}>
              {data.comment ?? 'No description yet.'}
            </p>
          </section>
        ) : null}

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
          {/* Below md the lower-priority columns drop out rather than scrolling sideways — this
              panel is the mobile explorer's landing view. Above md the table keeps its full width
              and the wrapper scrolls, so a narrow desktop window never silently clips it.
              `overflow-y-hidden` is load-bearing: CSS promotes the other axis to `auto` when one is
              not `visible`, and on a long table sub-pixel row rounding then paints a spurious second
              vertical scrollbar next to the panel's own. The wrapper is never taller than its table,
              so clipping the axis costs nothing. */}
          <div ref={columnsRef} className="overflow-x-auto overflow-y-hidden rounded-md border border-border">
            <table className="w-full border-collapse text-sm md:min-w-[640px]">
              <thead>
                <tr className="border-b border-border bg-surface-sunken text-xs uppercase tracking-wider text-text-faint">
                  <th className={`${HEAD} hidden w-8 text-right md:table-cell`}>#</th>
                  <th className={HEAD}>Column</th>
                  <th className={HEAD}>Type</th>
                  <th className={`${HEAD} hidden md:table-cell`}>Not null</th>
                  <th className={`${HEAD} hidden md:table-cell`}>Default</th>
                  <th className={HEAD}>Keys</th>
                  <th className={`${HEAD} hidden md:table-cell`}>Comment</th>
                  {showColumnActions ? <th className={`${CELL} text-right font-medium`} aria-label="Actions" /> : null}
                </tr>
              </thead>
              <tbody>
                {data.columns.map((col, i) => {
                  const columnIndexes = indexesByColumn.get(col.name) ?? [];
                  const columnForeignKeys = foreignKeysByColumn.get(col.name) ?? [];
                  const uniqueIndex = columnIndexes.find(marksColumnUnique);
                  // `bigint unsigned` is a base type plus a modifier — chip them separately rather
                  // than colouring the modifier as if it were part of the type name.
                  const columnType = splitTypeModifiers(col.nativeType ?? col.dataType);
                  return (
                      <tr
                        key={col.name}
                        data-column={col.name}
                        className={clsx(
                          'group transition-colors',
                          i < data.columns.length - 1 && 'border-b border-border',
                          highlightedColumn === col.name && 'bg-accent-muted',
                        )}
                      >
                        <td className={`${CELL} hidden text-right tabular-nums text-text-faint md:table-cell`}>
                          {i + 1}
                        </td>
                        <td className={CELL}>
                          <span className="flex items-center gap-xs">
                            <span className="font-medium text-text">{col.name}</span>
                            {columnForeignKeys.map((fk) => {
                              const target = `${fk.referencedTable}.${referencedColumnFor(fk, col.name)}`;
                              return (
                                <Tooltip key={fk.constraintName} content={target}>
                                  <button
                                    type="button"
                                    aria-label={`References ${target} (${fk.constraintName})`}
                                    onClick={() =>
                                      revealTableColumn(
                                        connectionId,
                                        fk.referencedSchema ?? schema,
                                        fk.referencedTable,
                                        referencedColumnFor(fk, col.name),
                                      )
                                    }
                                    className="text-text-faint transition-colors hover:text-accent"
                                  >
                                    <Link2 size={13} />
                                  </button>
                                </Tooltip>
                              );
                            })}
                          </span>
                        </td>
                        <td className={CELL}>
                          <span className="flex flex-wrap items-center gap-xs">
                            <ColumnTypePill dataType={columnType.base} size="normal" />
                            {columnType.modifiers.map((modifier) => (
                              <Badge key={modifier} variant="neutral">
                                {modifier}
                              </Badge>
                            ))}
                          </span>
                        </td>
                        <td className={`${CELL} hidden md:table-cell`}>
                          {col.nullable ? (
                            DASH
                          ) : (
                            <Badge variant="neutral" className={KEY_CHIP}>
                              not null
                            </Badge>
                          )}
                        </td>
                        <td className={`${CELL} hidden max-w-[12rem] md:table-cell`}>
                          {col.defaultValue !== null || col.autoIncrement ? (
                            <span className="flex items-center gap-xs">
                              {col.defaultValue !== null ? (
                                <span className="truncate font-mono text-xs text-text-muted" title={col.defaultValue}>
                                  {col.defaultValue}
                                </span>
                              ) : null}
                              {col.autoIncrement ? (
                                <Badge variant="neutral" title="Generated by the engine on insert">
                                  auto
                                </Badge>
                              ) : null}
                            </span>
                          ) : (
                            DASH
                          )}
                        </td>
                        <td className={CELL}>
                          {col.isPrimaryKey || uniqueIndex || columnIndexes.length > 0 ? (
                            <span className="flex items-center gap-xs">
                              {/* Three chips of the same shape, told apart by colour: accent = key,
                                  green = unique, grey = plain index. */}
                              {col.isPrimaryKey ? (
                                <Tooltip content="Primary key">
                                  <Badge variant="gold" className={KEY_CHIP}>
                                    <KeyRound size={11} aria-hidden />
                                    <span className="sr-only">Primary key</span>
                                  </Badge>
                                </Tooltip>
                              ) : null}
                              {uniqueIndex ? (
                                <Tooltip content={`Unique (${uniqueIndex.name})`}>
                                  <Badge variant="success" className={KEY_CHIP}>
                                    <Fingerprint size={11} aria-hidden />
                                    <span className="sr-only">Unique</span>
                                  </Badge>
                                </Tooltip>
                              ) : null}
                              {columnIndexes.length > 0 ? (
                                <Tooltip content={indexChipTooltip(columnIndexes)}>
                                  <button
                                    type="button"
                                    aria-label={`${columnIndexes.length} ${columnIndexes.length === 1 ? 'index' : 'indexes'} on ${col.name}`}
                                    onClick={() => setIndexModalColumn(col.name)}
                                    className="inline-flex"
                                  >
                                    <Badge
                                      variant="info"
                                      className={`${KEY_CHIP} transition-opacity hover:opacity-80`}
                                    >
                                      <ListTree size={11} aria-hidden />
                                      {columnIndexes.length}
                                    </Badge>
                                  </button>
                                </Tooltip>
                              ) : null}
                            </span>
                          ) : (
                            DASH
                          )}
                        </td>
                        {/* Comments run arbitrarily long, so the column shows a single clipped line
                            and defers the full text to a popup. */}
                        <td className={`${CELL} hidden max-w-[16rem] md:table-cell`}>
                          {col.comment ? (
                            <button
                              type="button"
                              aria-label={`Show comment on ${col.name}`}
                              title={col.comment}
                              onClick={() => setViewingComment({ column: col.name, comment: col.comment! })}
                              className="block w-full truncate text-left text-xs text-text-muted hover:text-text"
                            >
                              {col.comment}
                            </button>
                          ) : (
                            DASH
                          )}
                        </td>
                        {showColumnActions ? (
                          <td className={`${CELL} text-right`}>
                            <div className="flex items-center justify-end gap-xs">
                              {canEditComments ? (
                                <IconButton
                                  aria-label={`Edit comment on ${col.name}`}
                                  title="Edit comment"
                                  onClick={() => setCommentTarget({ column: col.name })}
                                  className="opacity-0 transition-opacity group-hover:opacity-100 max-md:opacity-100"
                                >
                                  <MessageSquareText size={13} />
                                </IconButton>
                              ) : null}
                              {writable ? (
                                <IconButton
                                  aria-label={`Edit column ${col.name}`}
                                  onClick={() => setEditingColumn(col)}
                                  className="opacity-0 transition-opacity group-hover:opacity-100 max-md:opacity-100"
                                >
                                  <Pencil size={13} />
                                </IconButton>
                              ) : null}
                            </div>
                          </td>
                        ) : null}
                      </tr>
                  );
                })}
              </tbody>
            </table>
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
            <div className="overflow-x-auto overflow-y-hidden rounded-md border border-border">
              <table className="w-full border-collapse text-sm md:min-w-[720px]">
                <thead>
                  <tr className="border-b border-border bg-surface-sunken text-xs uppercase tracking-wider text-text-faint">
                    <th className={HEAD}>Name</th>
                    <th className={HEAD}>Columns</th>
                    <th className={HEAD}>Kind</th>
                    <th className={`${HEAD} hidden md:table-cell`}>Method</th>
                    <th className={`${HEAD} hidden xl:table-cell`}>Definition</th>
                    {writable ? <th className={`${CELL} text-right font-medium`} aria-label="Actions" /> : null}
                  </tr>
                </thead>
                <tbody>
                  {data.indexes.map((idx, i) => (
                    <tr
                      key={idx.name}
                      className={i < data.indexes.length - 1 ? 'border-b border-border' : undefined}
                    >
                      <td className={CELL}>
                        <span className="font-medium text-text">{idx.name}</span>
                        <span className="mt-xs block text-xs text-text-faint md:hidden">{idx.method}</span>
                      </td>
                      <td className={`${CELL} font-mono text-xs text-text-muted`}>{idx.columns.join(', ')}</td>
                      <td className={CELL}>
                        <IndexKindBadge index={idx} />
                      </td>
                      <td className={`${CELL} hidden text-xs text-text-muted md:table-cell`}>{idx.method}</td>
                      <td className={`${CELL} hidden max-w-[24rem] xl:table-cell`}>
                        {idx.definition ? (
                          <code className="block truncate text-xs text-text-faint" title={idx.definition}>
                            {idx.definition}
                          </code>
                        ) : (
                          DASH
                        )}
                      </td>
                      {writable ? (
                        <td className={`${CELL} text-right`}>
                          <div className="flex items-center justify-end gap-xs">
                            {!idx.isPrimary ? (
                              <IconButton
                                aria-label={`Drop index ${idx.name}`}
                                onClick={() => void handleDropIndex(idx.name)}
                                disabled={dropIndex.isPending}
                              >
                                <Trash2 size={13} />
                              </IconButton>
                            ) : null}
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section>
          <div className="mb-sm flex items-center justify-between">
            <h2 className="text-xs font-medium uppercase tracking-wider text-text-faint">
              Foreign keys ({data.foreignKeys.length})
            </h2>
            {writable && supportsForeignKeyDdl ? (
              <Button variant="ghost" size="sm" onClick={() => setAddForeignKeyOpen(true)}>
                <Plus size={13} />
                Add foreign key
              </Button>
            ) : null}
          </div>
          {data.foreignKeys.length === 0 ? (
            <p className="text-sm italic text-text-faint">No foreign keys.</p>
          ) : (
            <div className="overflow-x-auto overflow-y-hidden rounded-md border border-border">
              <table className="w-full border-collapse text-sm md:min-w-[720px]">
                <thead>
                  <tr className="border-b border-border bg-surface-sunken text-xs uppercase tracking-wider text-text-faint">
                    <th className={HEAD}>Name</th>
                    <th className={HEAD}>Columns</th>
                    <th className={HEAD}>References</th>
                    <th className={`${HEAD} hidden md:table-cell`}>On delete</th>
                    <th className={`${HEAD} hidden md:table-cell`}>On update</th>
                    {writable && supportsForeignKeyDdl ? (
                      <th className={`${CELL} text-right font-medium`} aria-label="Actions" />
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {data.foreignKeys.map((fk, i) => (
                    <tr
                      key={fk.constraintName}
                      className={i < data.foreignKeys.length - 1 ? 'border-b border-border' : undefined}
                    >
                      <td className={CELL}>
                        <span className="font-medium text-text">{fk.constraintName}</span>
                        {/* On delete / on update are hidden below md — keep them reachable there. */}
                        {fk.onDelete || fk.onUpdate ? (
                          <span className="mt-xs flex flex-wrap gap-xs text-xs text-text-faint md:hidden">
                            {fk.onDelete ? <span>ON DELETE {fk.onDelete}</span> : null}
                            {fk.onUpdate ? <span>ON UPDATE {fk.onUpdate}</span> : null}
                          </span>
                        ) : null}
                      </td>
                      <td className={`${CELL} font-mono text-xs text-text-muted`}>{fk.columns.join(', ')}</td>
                      <td className={`${CELL} font-mono text-xs text-text-muted`}>{referenceLabel(fk)}</td>
                      <td className={`${CELL} hidden text-xs text-text-muted md:table-cell`}>
                        {fk.onDelete ?? DASH}
                      </td>
                      <td className={`${CELL} hidden text-xs text-text-muted md:table-cell`}>
                        {fk.onUpdate ?? DASH}
                      </td>
                      {writable && supportsForeignKeyDdl ? (
                        <td className={`${CELL} text-right`}>
                          <div className="flex items-center justify-end gap-xs">
                            <IconButton
                              aria-label={`Drop foreign key ${fk.constraintName}`}
                              onClick={() => void handleDropForeignKey(fk.constraintName)}
                              disabled={alterTable.isPending}
                            >
                              <Trash2 size={13} />
                            </IconButton>
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
