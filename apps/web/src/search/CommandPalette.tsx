import { useEffect, useMemo, useRef, useState } from 'react';
import { Code, Columns3, History, Search, Table, X } from 'lucide-react';
import clsx from 'clsx';
import { IconButton, Input, Surface } from '@prost/ui';
import { useMetadata } from '../api/metadata';
import { useSnippets } from '../api/snippets';
import { useHistorySearch } from '../api/history';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useIsMobile } from '../hooks/useMediaQuery';
import { useCommandPaletteStore } from '../stores/commandPaletteStore';
import { useConnectionStore } from '../stores/connectionStore';
import { useWorkspaceStore } from '../stores/workspaceStore';
import {
  buildMetadataItems,
  createMetadataFuse,
  createSnippetFuse,
  flattenResults,
  search,
  type GroupedResults,
  type SearchItem,
} from './searchIndex';

const SECTION_META = [
  { key: 'tables', title: 'Tables', icon: Table },
  { key: 'columns', title: 'Columns', icon: Columns3 },
  { key: 'snippets', title: 'Snippets', icon: Code },
  { key: 'history', title: 'History', icon: History },
] as const;

/**
 * ⌘K global search overlay. Fuzzy-searches cached metadata + snippets and server-paged history,
 * grouped and bounded, then navigates (table/column) or loads SQL (snippet/history) into the active
 * query tab — never auto-runs (principles §4/§8). Open/close is driven by `commandPaletteStore`.
 */
export function CommandPalette() {
  const open = useCommandPaletteStore((s) => s.open);
  const closePalette = useCommandPaletteStore((s) => s.closePalette);
  const isMobile = useIsMobile();

  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId);
  const openTable = useWorkspaceStore((s) => s.openTable);
  const revealTableColumn = useWorkspaceStore((s) => s.revealTableColumn);
  const loadQuery = useWorkspaceStore((s) => s.loadQuery);

  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const debounced = useDebouncedValue(query, 150);
  const listRef = useRef<HTMLDivElement>(null);

  const { data: schemas } = useMetadata(open ? activeConnectionId : null);
  const { data: snippets } = useSnippets();
  const { data: history } = useHistorySearch({
    connectionId: activeConnectionId,
    search: debounced,
    enabled: open && debounced.trim() !== '',
  });

  const metadataFuse = useMemo(() => createMetadataFuse(buildMetadataItems(schemas ?? [])), [schemas]);
  const snippetFuse = useMemo(() => createSnippetFuse(snippets ?? []), [snippets]);
  const groups: GroupedResults = useMemo(
    () => search(debounced, metadataFuse, snippetFuse, history ?? []),
    [debounced, metadataFuse, snippetFuse, history],
  );
  const flat = useMemo(() => flattenResults(groups), [groups]);

  // Reset on open; keep the active row clamped as results change.
  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
    }
  }, [open]);
  useEffect(() => {
    setActiveIndex((i) => Math.min(i, Math.max(flat.length - 1, 0)));
  }, [flat.length]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (!open) return null;

  function handleSelect(item: SearchItem) {
    switch (item.type) {
      case 'table':
        openTable(item.schema, item.table, 'rows');
        break;
      case 'column':
        revealTableColumn(item.schema, item.table, item.column);
        break;
      case 'snippet':
        loadQuery(item.body);
        break;
      case 'history':
        loadQuery(item.sql);
        break;
    }
    closePalette();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, flat.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = flat[activeIndex];
      if (item) handleSelect(item);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closePalette();
    }
  }

  const isEmptyQuery = debounced.trim() === '';
  let runningIndex = 0;

  const panel = (
    <Surface
      level="overlay"
      bordered
      className={clsx(
        'flex flex-col overflow-hidden',
        isMobile ? 'h-full w-full' : 'w-full max-w-xl rounded-lg shadow-2xl',
      )}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-sm border-b border-border px-md">
        <Search size={16} className="shrink-0 text-text-faint" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search tables, columns, snippets, history…"
          aria-label="Search"
          className="h-11 flex-1 border-0 bg-transparent focus:border-0"
          autoFocus
        />
        {isMobile ? (
          <IconButton aria-label="Close search" onClick={closePalette}>
            <X size={16} />
          </IconButton>
        ) : null}
      </div>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-xs">
        {isEmptyQuery ? (
          <p className="px-md py-6 text-center text-xs italic text-text-faint">
            Type to search tables, columns, snippets, and query history.
          </p>
        ) : flat.length === 0 ? (
          <p className="px-md py-6 text-center text-xs italic text-text-faint">No results.</p>
        ) : (
          SECTION_META.map(({ key, title, icon: Icon }) => {
            const items = groups[key];
            if (items.length === 0) return null;
            return (
              <div key={key} className="mb-xs">
                <h3 className="px-md pb-1 pt-2 text-xs font-medium uppercase tracking-wider text-text-faint">
                  {title}
                </h3>
                {items.map((item) => {
                  const index = runningIndex++;
                  return (
                    <ResultRow
                      key={`${key}-${resultKey(item)}`}
                      item={item}
                      icon={<Icon size={14} className="shrink-0 text-text-faint" />}
                      active={index === activeIndex}
                      index={index}
                      onMouseEnter={() => setActiveIndex(index)}
                      onSelect={() => handleSelect(item)}
                    />
                  );
                })}
              </div>
            );
          })
        )}
      </div>
    </Surface>
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Global search"
      onMouseDown={closePalette}
      className={clsx(
        'fixed inset-0 z-50 flex',
        isMobile ? 'flex-col bg-bg' : 'justify-center bg-black/50 p-md md:items-start md:pt-[12vh]',
      )}
    >
      {panel}
    </div>
  );
}

function resultKey(item: SearchItem): string {
  switch (item.type) {
    case 'table':
      return `${item.schema}.${item.table}`;
    case 'column':
      return `${item.schema}.${item.table}.${item.column}`;
    default:
      return item.id;
  }
}

interface ResultRowProps {
  item: SearchItem;
  icon: React.ReactNode;
  active: boolean;
  index: number;
  onMouseEnter: () => void;
  onSelect: () => void;
}

function ResultRow({ item, icon, active, index, onMouseEnter, onSelect }: ResultRowProps) {
  const { title, subtitle } = rowText(item);
  return (
    <button
      type="button"
      data-index={index}
      onMouseEnter={onMouseEnter}
      onClick={onSelect}
      className={clsx(
        'flex w-full items-center gap-sm rounded-sm px-md py-2 text-left',
        active ? 'bg-accent-muted' : 'hover:bg-surface-hover',
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate text-sm text-text">{title}</span>
      {subtitle ? (
        <span className="shrink-0 truncate font-mono text-xs text-text-faint" title={subtitle}>
          {subtitle}
        </span>
      ) : null}
    </button>
  );
}

function rowText(item: SearchItem): { title: string; subtitle: string } {
  switch (item.type) {
    case 'table':
      return { title: item.table, subtitle: item.schema };
    case 'column':
      return { title: item.label, subtitle: item.dataType };
    case 'snippet':
      return { title: item.name, subtitle: item.body };
    case 'history':
      return { title: item.label ?? item.sql, subtitle: item.label ? item.sql : item.connectionName };
  }
}
