import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Code, FileText, LayoutGrid, Plus, Table2, X } from 'lucide-react';
import clsx from 'clsx';

export interface WorkspaceTab {
  id: string;
  label: string;
  kind: 'table' | 'query' | 'overview' | 'object';
}

export interface WorkspaceTabBarProps {
  tabs: WorkspaceTab[];
  activeTabId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNewTab: () => void;
  onReorder: (draggedId: string, targetId: string) => void;
  onCloseOthers: (id: string) => void;
  onCloseToLeft: (id: string) => void;
  onCloseToRight: (id: string) => void;
  onCloseAllTables: () => void;
}

interface TabMenuState {
  x: number;
  y: number;
  tabId: string;
}

export function WorkspaceTabBar({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onNewTab,
  onReorder,
  onCloseOthers,
  onCloseToLeft,
  onCloseToRight,
  onCloseAllTables,
}: WorkspaceTabBarProps) {
  const queryTabCount = tabs.filter((tab) => tab.kind === 'query').length;
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [menu, setMenu] = useState<TabMenuState | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    setOverflowing(maxScroll > 1);
    setCanLeft(el.scrollLeft > 0);
    setCanRight(el.scrollLeft < maxScroll - 1);
  }, []);

  // Track overflow / edge state on resize and scroll so the arrows show & disable correctly.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateScrollState();
    const ro = new ResizeObserver(updateScrollState);
    ro.observe(el);
    el.addEventListener('scroll', updateScrollState, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', updateScrollState);
    };
  }, [updateScrollState]);

  // Recompute when the set of tabs changes (added/closed/reordered).
  useEffect(() => updateScrollState(), [tabs, updateScrollState]);

  // Vertical mouse wheel scrolls the strip horizontally. Native non-passive listener so we can
  // preventDefault (and keep the page from scrolling); trackpads sending deltaX also work.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return;
      const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX;
      if (delta === 0) return;
      e.preventDefault();
      el.scrollLeft += delta;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Keep the active tab in view when it changes (e.g. opening a table off-screen).
  useEffect(() => {
    const el = scrollRef.current?.querySelector(`[data-tab-id="${CSS.escape(activeTabId)}"]`);
    el?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [activeTabId]);

  function scrollByStep(direction: 1 | -1) {
    scrollRef.current?.scrollBy({ left: direction * scrollRef.current.clientWidth * 0.6, behavior: 'smooth' });
  }

  // Dismiss the context menu on any outside click or another right-click (matches SchemaTree).
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    document.addEventListener('click', close);
    document.addEventListener('contextmenu', close);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('contextmenu', close);
    };
  }, [menu]);

  function renderMenu() {
    if (!menu) return null;
    const idx = tabs.findIndex((tab) => tab.id === menu.tabId);
    if (idx === -1) return null;
    const target = tabs[idx]!;
    const canCloseThis = target.kind !== 'query' || queryTabCount > 1;
    const hasOthers = tabs.length > 1;
    const hasLeft = idx > 0;
    const hasRight = idx < tabs.length - 1;
    const hasTables = tabs.some((tab) => tab.kind === 'table');

    const item = (label: string, enabled: boolean, action: () => void) => (
      <button
        type="button"
        disabled={!enabled}
        className={clsx(
          'flex w-full items-center px-3 py-1.5 text-left text-xs',
          enabled ? 'text-text hover:bg-surface-hover' : 'cursor-not-allowed text-text-faint',
        )}
        onClick={() => {
          action();
          setMenu(null);
        }}
      >
        {label}
      </button>
    );

    return (
      <div
        className="fixed z-50 min-w-[180px] overflow-hidden rounded-md border border-border bg-surface py-1 shadow-lg"
        style={{ left: menu.x, top: menu.y }}
        onClick={(e) => e.stopPropagation()}
      >
        {item('Close', canCloseThis, () => onClose(menu.tabId))}
        {item('Close Others', hasOthers, () => onCloseOthers(menu.tabId))}
        {item('Close to the Left', hasLeft, () => onCloseToLeft(menu.tabId))}
        {item('Close to the Right', hasRight, () => onCloseToRight(menu.tabId))}
        <div className="my-1 h-px bg-border" />
        {item('Close All Tables', hasTables, () => onCloseAllTables())}
      </div>
    );
  }

  const controlButton = 'flex h-7 max-md:h-9 max-md:px-2 shrink-0 items-center rounded-t-sm px-1 text-text-muted transition-colors hover:bg-surface-hover hover:text-text disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <div className="flex h-8 max-md:h-11 shrink-0 items-end border-b border-border bg-surface-sunken px-sm pt-1">
      <div
        ref={scrollRef}
        className="no-scrollbar flex flex-1 items-end gap-1 overflow-x-auto"
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const Icon =
            tab.kind === 'overview' ? LayoutGrid
            : tab.kind === 'table' ? Table2
            : tab.kind === 'object' ? FileText
            : Code;
          const canClose = tab.kind !== 'query' || queryTabCount > 1;
          const isDropTarget = dragOverId === tab.id && draggedId !== null && draggedId !== tab.id;
          return (
            <div
              key={tab.id}
              data-tab-id={tab.id}
              draggable
              onDragStart={(e) => {
                setDraggedId(tab.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => {
                if (draggedId === null || draggedId === tab.id) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                setDragOverId(tab.id);
              }}
              onDragLeave={() => setDragOverId((cur) => (cur === tab.id ? null : cur))}
              onDrop={(e) => {
                e.preventDefault();
                if (draggedId && draggedId !== tab.id) onReorder(draggedId, tab.id);
                setDraggedId(null);
                setDragOverId(null);
              }}
              onDragEnd={() => {
                setDraggedId(null);
                setDragOverId(null);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setMenu({ x: e.clientX, y: e.clientY, tabId: tab.id });
              }}
              className={clsx(
                'flex h-7 max-md:h-9 shrink-0 items-center gap-sm whitespace-nowrap rounded-t-sm border border-b-0 px-sm text-xs transition-colors max-md:text-sm',
                isActive
                  ? 'border-border border-b-2 border-b-accent bg-bg text-text'
                  : 'border-transparent text-text-muted hover:bg-surface-hover hover:text-text',
                isDropTarget && 'border-l-2 border-l-accent',
                draggedId === tab.id && 'opacity-50',
              )}
            >
              <button type="button" onClick={() => onSelect(tab.id)} className="flex items-center gap-1 self-stretch whitespace-nowrap">
                <Icon size={14} className="shrink-0" />
                {tab.label}
              </button>
              {canClose ? (
                <button
                  type="button"
                  aria-label={`Close ${tab.label}`}
                  onClick={() => onClose(tab.id)}
                  className="shrink-0 rounded-sm text-text-faint transition-colors hover:text-text max-md:-mr-1 max-md:p-1"
                >
                  <X size={12} />
                </button>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="flex shrink-0 items-end gap-1 pl-1">
        <button type="button" aria-label="New query tab" onClick={onNewTab} className={controlButton}>
          <Plus size={14} />
        </button>
        {overflowing ? (
          <>
            <button
              type="button"
              aria-label="Scroll tabs left"
              onClick={() => scrollByStep(-1)}
              disabled={!canLeft}
              className={controlButton}
            >
              <ChevronLeft size={14} />
            </button>
            <button
              type="button"
              aria-label="Scroll tabs right"
              onClick={() => scrollByStep(1)}
              disabled={!canRight}
              className={controlButton}
            >
              <ChevronRight size={14} />
            </button>
          </>
        ) : null}
      </div>
      {renderMenu()}
    </div>
  );
}
