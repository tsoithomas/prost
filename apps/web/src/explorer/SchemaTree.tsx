import { useEffect, useState } from 'react';
import { Box, ChevronDown, ChevronRight, Plus, Rows3, StretchHorizontal, Table2 } from 'lucide-react';
import clsx from 'clsx';
import type { SchemaMetadata, TableSummary } from '@prost/shared-types';

export interface SchemaTreeProps {
  schemas: SchemaMetadata[];
  /** Composite `schema.table` key of the selected table, or `null` if none is selected. */
  selectedTable: string | null;
  onSelectTable: (table: TableSummary) => void;
  onOpenStructure: (table: TableSummary) => void;
  onNewTable: (schema: string) => void;
}

interface ContextMenuState {
  x: number;
  y: number;
  table: TableSummary;
}

export function SchemaTree({ schemas, selectedTable, onSelectTable, onOpenStructure, onNewTable }: SchemaTreeProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

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

  return (
    <div>
      <div className="mb-2 px-sm text-xs font-medium uppercase tracking-wider text-text-faint">Schemas</div>
      {schemas.map((schema) => {
        const isCollapsed = collapsed.has(schema.name);
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
                aria-label={`New table in ${schema.name}`}
                title={`New table in ${schema.name}`}
                onClick={(e) => { e.stopPropagation(); onNewTable(schema.name); }}
                className="mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-text-faint opacity-0 transition-opacity hover:bg-surface-hover hover:text-text group-hover/schema:opacity-100"
              >
                <Plus size={12} />
              </button>
            </div>
            {isCollapsed ? null : (
              <div className="ml-2 mt-0.5 flex flex-col gap-0.5 border-l border-border pl-3">
                {schema.tables.map((table) => (
                  <button
                    key={table.name}
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
                    )}
                  >
                    <Table2 size={14} />
                    <span>{table.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {contextMenu ? (
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
        </div>
      ) : null}
    </div>
  );
}
