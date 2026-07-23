import { useEffect, useState } from 'react';
import {
  Box, ChevronDown, ChevronRight, Eye, FunctionSquare, Layers, LayoutGrid, List, ListOrdered,
  Pin, PinOff, Plus, Rows3, Search, SquareCode, StretchHorizontal, Table2, X, Zap,
} from 'lucide-react';
import clsx from 'clsx';
import type { SchemaMetadata, SchemaObjectKind, SchemaObjectSummary, TableSummary } from '@prost/shared-types';
import { Input } from '@prost/ui';

/** Fixed render order + presentation for the non-table object groups under a schema. */
const OBJECT_KINDS: { kind: SchemaObjectKind; label: string; Icon: typeof Eye }[] = [
  { kind: 'view', label: 'Views', Icon: Eye },
  { kind: 'materializedView', label: 'Materialized Views', Icon: Layers },
  { kind: 'sequence', label: 'Sequences', Icon: ListOrdered },
  { kind: 'function', label: 'Functions', Icon: FunctionSquare },
  { kind: 'procedure', label: 'Procedures', Icon: SquareCode },
  { kind: 'trigger', label: 'Triggers', Icon: Zap },
  { kind: 'enum', label: 'Enums', Icon: List },
];

export interface SchemaTreeProps {
  schemas: SchemaMetadata[];
  /** Composite `schema.table` key of the selected table, or `null` if none is selected. */
  selectedTable: string | null;
  /** Composite `schema.name` key of the selected non-table object, or `null`. */
  selectedObject?: string | null;
  onSelectTable: (table: TableSummary) => void;
  onOpenStructure: (table: TableSummary) => void;
  /** Open a non-table object (parent routes views/matviews to the grid, others to a definition panel). */
  onSelectObject: (object: SchemaObjectSummary) => void;
  onNewTable: (schema: string) => void;
  onOpenOverview: (schema: string) => void;
  /** Engines without a schema layer (SQLite) render a flat table list instead of schema groups. */
  hasSchemas?: boolean;
  /** Read-only connections (the app DB) hide write affordances like "New table". */
  writable?: boolean;
  /** Composite `schema.table` keys of pinned tables, shown in a "Pinned" section at the top. */
  pinnedKeys?: Set<string>;
  /** Toggle a table's pinned state. When omitted, pinning affordances are hidden. */
  onTogglePin?: (table: TableSummary) => void;
}

interface ContextMenuState {
  x: number;
  y: number;
  table: TableSummary;
}

export function SchemaTree({
  schemas,
  selectedTable,
  selectedObject = null,
  onSelectTable,
  onOpenStructure,
  onSelectObject,
  onNewTable,
  onOpenOverview,
  hasSchemas = true,
  writable = true,
  pinnedKeys,
  onTogglePin,
}: SchemaTreeProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [filter, setFilter] = useState('');

  const query = filter.trim().toLowerCase();
  const matchesQuery = (table: TableSummary) =>
    query === '' || table.name.toLowerCase().includes(query);
  const matchesObject = (object: SchemaObjectSummary) =>
    query === '' || object.name.toLowerCase().includes(query);

  const tableKey = (table: TableSummary) => `${table.schema}.${table.name}`;
  const pinningEnabled = !!onTogglePin;
  const isPinned = (table: TableSummary) => pinnedKeys?.has(tableKey(table)) ?? false;
  // Resolve pinned keys back to their `TableSummary` (drop any that no longer exist),
  // preserving the pinned-order from the store.
  const pinnedTables: TableSummary[] =
    pinnedKeys && pinnedKeys.size > 0
      ? schemas
          .flatMap((schema) => schema.tables)
          .filter((table) => pinnedKeys.has(tableKey(table)) && matchesQuery(table))
      : [];

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    document.addEventListener('click', close);
    document.addEventListener('contextmenu', close);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('contextmenu', close);
    };
  }, [contextMenu]);

  function toggleSchema(name: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }

  const renderTableButton = (table: TableSummary, className?: string) => (
    <button
      key={`${table.schema}.${table.name}`}
      type="button"
      onClick={() => onSelectTable(table)}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({ x: e.clientX, y: e.clientY, table });
      }}
      className={clsx(
        'flex items-center gap-1 rounded-sm px-1 py-1 text-left text-xs transition-colors',
        selectedTable === `${table.schema}.${table.name}`
          ? 'bg-accent-muted text-accent'
          : 'text-text-muted hover:bg-surface-hover hover:text-text',
        className,
      )}
    >
      <Table2 size={14} className="shrink-0" />
      <span className="truncate">{table.name}</span>
    </button>
  );

  // A table button plus a right-aligned pin/unpin toggle: shown on hover for unpinned
  // tables, always visible (accent) for pinned ones.
  const renderTableRow = (table: TableSummary) => {
    const pinned = isPinned(table);
    return (
      <div key={`row:${tableKey(table)}`} className="group/row relative flex items-center">
        {renderTableButton(table, 'min-w-0 flex-1 pr-7')}
        {pinningEnabled ? (
          <button
            type="button"
            aria-label={pinned ? `Unpin ${table.name}` : `Pin ${table.name}`}
            title={pinned ? 'Unpin' : 'Pin to top'}
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin?.(table);
            }}
            className={clsx(
              'absolute right-1 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-sm transition-opacity hover:bg-surface-hover',
              pinned
                ? 'text-accent opacity-100'
                : 'text-text-faint opacity-0 hover:text-text group-hover/row:opacity-100',
            )}
          >
            {pinned ? <PinOff size={12} /> : <Pin size={12} />}
          </button>
        ) : null}
      </div>
    );
  };

  const renderObjectButton = (object: SchemaObjectSummary, Icon: typeof Eye) => {
    const key = `${object.schema ?? ''}.${object.name}`;
    // Views/matviews open as table tabs, so `selectedTable` reflects their selection; other kinds use `selectedObject`.
    const active = selectedObject === key || selectedTable === key;
    return (
      <button
        key={`${object.kind}:${key}`}
        type="button"
        onClick={() => onSelectObject(object)}
        title={object.comment ?? object.name}
        className={clsx(
          'flex items-center gap-1 rounded-sm px-1 py-1 text-left text-xs transition-colors',
          active ? 'bg-accent-muted text-accent' : 'text-text-muted hover:bg-surface-hover hover:text-text',
        )}
      >
        <Icon size={14} className="shrink-0" />
        <span className="truncate">{object.name}</span>
      </button>
    );
  };

  // Collapsible per-kind groups under a schema, one per object kind that has ≥1 (filter-matching) object.
  const renderObjectGroups = (schemaName: string, objects: SchemaObjectSummary[]) =>
    OBJECT_KINDS.map(({ kind, label, Icon }) => {
      const items = objects.filter((object) => object.kind === kind && matchesObject(object));
      if (items.length === 0) return null;
      const groupKey = `${schemaName}::${kind}`;
      const groupCollapsed = query === '' && collapsed.has(groupKey);
      return (
        <div key={kind}>
          <button
            type="button"
            onClick={() => toggleSchema(groupKey)}
            className="flex w-full items-center gap-1 rounded-sm px-1 py-1 text-left text-[11px] font-medium uppercase tracking-wider text-text-faint transition-colors hover:bg-surface-hover"
          >
            {groupCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            <span>{label} ({items.length})</span>
          </button>
          {groupCollapsed ? null : (
            <div className="ml-2 flex flex-col gap-0.5 border-l border-border pl-3">
              {items.map((object) => renderObjectButton(object, Icon))}
            </div>
          )}
        </div>
      );
    });

  // Engines without a schema layer (SQLite) render a single flat list of tables.
  if (!hasSchemas) {
    const allTables = schemas.flatMap((schema) => schema.tables);
    const tables = allTables.filter(matchesQuery);
    const flatSchema = schemas[0]?.name ?? 'main';
    const allObjects = schemas.flatMap((schema) => schema.objects);
    return (
      <div>
        {renderStickyTop()}
        <div className="mb-2 flex items-center justify-between px-sm">
          <span className="text-xs font-medium uppercase tracking-wider text-text-faint">Tables</span>
          <button
            type="button"
            aria-label="Database overview"
            title="Database overview"
            onClick={() => onOpenOverview(flatSchema)}
            className="flex h-5 w-5 items-center justify-center rounded-sm text-text-faint transition-colors hover:bg-surface-hover hover:text-text"
          >
            <LayoutGrid size={13} />
          </button>
        </div>
        {allTables.length === 0 ? (
          <p className="px-sm py-1 text-xs italic text-text-faint">No tables</p>
        ) : tables.length === 0 ? (
          <p className="px-sm py-1 text-xs italic text-text-faint">No tables match "{filter.trim()}"</p>
        ) : (
          <div className="flex flex-col gap-0.5">{tables.map(renderTableRow)}</div>
        )}
        <div className="mt-1 flex flex-col gap-0.5">{renderObjectGroups(flatSchema, allObjects)}</div>
        {renderContextMenu()}
      </div>
    );
  }

  const visibleSchemas =
    query === ''
      ? schemas
      : schemas
          .map((schema) => ({
            ...schema,
            tables: schema.tables.filter(matchesQuery),
            objects: schema.objects.filter(matchesObject),
          }))
          .filter((schema) => schema.tables.length > 0 || schema.objects.length > 0);

  return (
    <div>
      {renderStickyTop()}
      <div className="mb-2 px-sm text-xs font-medium uppercase tracking-wider text-text-faint">Schemas</div>
      {query !== '' && visibleSchemas.length === 0 ? (
        <p className="px-sm py-1 text-xs italic text-text-faint">No tables match "{filter.trim()}"</p>
      ) : null}
      {visibleSchemas.map((schema) => {
        // While filtering, matching schemas are force-expanded regardless of the collapsed set.
        const isCollapsed = query === '' && collapsed.has(schema.name);
        return (
          <div key={schema.name} className="group/schema">
            <div className="flex items-center">
              <button
                type="button"
                onClick={() => toggleSchema(schema.name)}
                className="flex min-w-0 flex-1 items-center gap-1 rounded-sm px-1 py-1 text-xs text-text transition-colors hover:bg-surface-hover"
              >
                {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                <Box size={14} className="shrink-0 text-accent" />
                <span className="truncate">{schema.name}</span>
              </button>
              <button
                type="button"
                aria-label={`Overview of ${schema.name}`}
                title={`Overview of ${schema.name}`}
                onClick={(e) => { e.stopPropagation(); onOpenOverview(schema.name); }}
                className={clsx(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-text-faint opacity-0 transition-opacity hover:bg-surface-hover hover:text-text group-hover/schema:opacity-100',
                  !writable && 'mr-1',
                )}
              >
                <LayoutGrid size={12} />
              </button>
              {writable ? (
                <button
                  type="button"
                  aria-label={`New table in ${schema.name}`}
                  title={`New table in ${schema.name}`}
                  onClick={(e) => { e.stopPropagation(); onNewTable(schema.name); }}
                  className="mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-text-faint opacity-0 transition-opacity hover:bg-surface-hover hover:text-text group-hover/schema:opacity-100"
                >
                  <Plus size={12} />
                </button>
              ) : null}
            </div>
            {isCollapsed ? null : (
              <div className="ml-2 mt-0.5 flex flex-col gap-0.5 border-l border-border pl-3">
                {schema.tables.map(renderTableRow)}
                {renderObjectGroups(schema.name, schema.objects)}
              </div>
            )}
          </div>
        );
      })}

      {renderContextMenu()}
    </div>
  );

  function renderFilterBox() {
    return (
      <div className="mb-2 pb-1 pt-1">
        <div className="relative">
          <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-text-faint" />
          <Input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter tables…"
            aria-label="Filter tables"
            className="h-7 w-full pl-7 pr-7 text-xs"
          />
          {filter ? (
            <button
              type="button"
              aria-label="Clear filter"
              onClick={() => setFilter('')}
              className="absolute right-1.5 top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded-sm text-text-faint hover:bg-surface-hover hover:text-text"
            >
              <X size={12} />
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  function renderContextMenu() {
    if (!contextMenu) return null;
    return (
      <div
        className="fixed z-50 min-w-[160px] overflow-hidden rounded-md border border-border bg-surface py-1 shadow-lg"
        style={{ left: contextMenu.x, top: contextMenu.y }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-text hover:bg-surface-hover"
          onClick={() => {
            onSelectTable(contextMenu.table);
            setContextMenu(null);
          }}
        >
          <Rows3 size={13} />
          Browse rows
        </button>
        <button
          type="button"
          className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-text hover:bg-surface-hover"
          onClick={() => {
            onOpenStructure(contextMenu.table);
            setContextMenu(null);
          }}
        >
          <StretchHorizontal size={13} />
          View structure
        </button>
        {pinningEnabled ? (
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-text hover:bg-surface-hover"
            onClick={() => {
              onTogglePin?.(contextMenu.table);
              setContextMenu(null);
            }}
          >
            {isPinned(contextMenu.table) ? <PinOff size={13} /> : <Pin size={13} />}
            {isPinned(contextMenu.table) ? 'Unpin from top' : 'Pin to top'}
          </button>
        ) : null}
      </div>
    );
  }

  // Filter box + pinned tables, kept together in one sticky header so pinned tables
  // stay at the top while the rest of the tree scrolls beneath them.
  function renderStickyTop() {
    return (
      <div className="sticky top-0 z-10 bg-surface-sunken">
        {renderFilterBox()}
        {renderPinnedSection()}
      </div>
    );
  }

  function renderPinnedSection() {
    if (!pinningEnabled || pinnedTables.length === 0) return null;
    return (
      <div className="mb-2">
        <div className="mb-1 flex items-center gap-1 px-sm text-xs font-medium uppercase tracking-wider text-text-faint">
          <Pin size={11} />
          <span>Pinned</span>
        </div>
        <div className="flex max-h-44 flex-col gap-0.5 overflow-y-auto">
          {pinnedTables.map(renderTableRow)}
        </div>
      </div>
    );
  }
}
