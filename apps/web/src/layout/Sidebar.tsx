import { useEffect, useRef, useState } from 'react';
import {
  Check, ChevronDown, Code, Database, History, Network, PanelLeftClose, PanelLeftOpen, Plug,
  Plus, Trash2,
} from 'lucide-react';
import clsx from 'clsx';
import type { ConnectionDto } from '@prost/shared-types';
import { Badge, IconButton } from '@prost/ui';
import { useActiveConnection, useConnections, useDeleteConnection } from '../api/connections';
import { connectionEndpoint } from '../connection/connectionDisplay';
import { useMetadata } from '../api/metadata';
import { CreateTableModal } from '../ddl/CreateTableModal';
import { QueryHistoryList } from '../explorer/QueryHistoryList';
import { SchemaTree } from '../explorer/SchemaTree';
import { openSchemaObject, selectedObjectKey } from '../explorer/objectNavigation';
import { SnippetList } from '../explorer/SnippetList';
import { useConfirm } from '../hooks/useConfirm';
import { useResizableWidth } from '../hooks/useResizableWidth';
import { useConnectionStore } from '../stores/connectionStore';
import { MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, useLayoutStore } from '../stores/layoutStore';
import { usePinnedTablesStore } from '../stores/pinnedTablesStore';
import { useWorkspaceStore } from '../stores/workspaceStore';

type SidebarTab = 'explorer' | 'history' | 'snippets';

const sidebarTabs: { key: SidebarTab; label: string; icon: typeof Database }[] = [
  { key: 'explorer', label: 'Explorer', icon: Network },
  { key: 'history', label: 'History', icon: History },
  { key: 'snippets', label: 'Snippets', icon: Code },
];

export interface SidebarProps {
  onNewConnection: () => void;
}

export function Sidebar({ onNewConnection }: SidebarProps) {
  const [activeTab, setActiveTab] = useState<SidebarTab>('explorer');
  const [collapsed, setCollapsed] = useState(false);
  const [connMenuOpen, setConnMenuOpen] = useState(false);
  const connMenuRef = useRef<HTMLDivElement>(null);
  const sidebarWidth = useLayoutStore((state) => state.leftSidebarWidth);
  const setSidebarWidth = useLayoutStore((state) => state.setLeftSidebarWidth);
  const { isResizing, onPointerDown } = useResizableWidth({
    width: sidebarWidth,
    min: MIN_SIDEBAR_WIDTH,
    max: MAX_SIDEBAR_WIDTH,
    onResize: setSidebarWidth,
    side: 'left',
  });
  const activeConnectionId = useConnectionStore((state) => state.activeConnectionId);
  const setActive = useConnectionStore((state) => state.setActive);
  const activeConnection = useActiveConnection();
  const { data: connections = [] } = useConnections();
  const deleteConnection = useDeleteConnection();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const { data: schemas, isLoading, isError } = useMetadata(activeConnectionId);
  const workspaceTabs = useWorkspaceStore((state) => state.tabs);
  const activeWorkspaceTabId = useWorkspaceStore((state) => state.activeTabId);
  const openTable = useWorkspaceStore((state) => state.openTable);
  const openObject = useWorkspaceStore((state) => state.openObject);
  const openOverview = useWorkspaceStore((state) => state.openOverview);
  const loadQuery = useWorkspaceStore((state) => state.loadQuery);

  const pinnedByConnection = usePinnedTablesStore((state) => state.pinned);
  const togglePinned = usePinnedTablesStore((state) => state.toggle);
  const pinnedKeys = new Set(activeConnectionId ? pinnedByConnection[activeConnectionId] ?? [] : []);

  const [createTableState, setCreateTableState] = useState<{ open: boolean; schema: string }>({
    open: false,
    schema: '',
  });

  const activeWorkspaceTab = workspaceTabs.find((tab) => tab.id === activeWorkspaceTabId);
  const selectedTable =
    activeWorkspaceTab?.kind === 'table' && activeWorkspaceTab.schema
      ? `${activeWorkspaceTab.schema}.${activeWorkspaceTab.table}`
      : null;
  const selectedObject = selectedObjectKey(activeWorkspaceTab);

  // Close the connection dropdown on outside click / Escape.
  useEffect(() => {
    if (!connMenuOpen) return;
    const onPointer = (event: MouseEvent) => {
      if (connMenuRef.current && !connMenuRef.current.contains(event.target as Node)) {
        setConnMenuOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setConnMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [connMenuOpen]);

  async function handleDeleteConnection(connection: ConnectionDto) {
    const confirmed = await confirm({
      title: 'Delete connection',
      description: `Delete connection "${connection.name}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!confirmed) return;

    deleteConnection.mutate(connection.id, {
      onSuccess: () => {
        if (activeConnectionId === connection.id) setActive(null);
      },
    });
  }

  function openTab(key: SidebarTab) {
    setActiveTab(key);
    if (collapsed) setCollapsed(false);
  }

  function renderTabPanel(key: SidebarTab) {
    if (key === 'explorer') {
      if (activeConnectionId === null) {
        return (
          <p className="px-sm py-2 text-xs italic text-text-faint">
            No active connection. Use the + button above to add one.
          </p>
        );
      }
      if (isLoading) return <p className="px-sm py-2 text-xs italic text-text-faint">Loading schemas…</p>;
      if (isError) return <p className="px-sm py-2 text-xs text-danger">Failed to load schemas.</p>;
      return (
        <SchemaTree
          schemas={schemas ?? []}
          selectedTable={selectedTable}
          selectedObject={selectedObject}
          onSelectTable={(table) => openTable(table.schema, table.name, 'rows')}
          onOpenStructure={(table) => openTable(table.schema, table.name, 'structure')}
          onSelectObject={(object) => openSchemaObject({ openTable, openObject }, object)}
          onNewTable={(schema) => setCreateTableState({ open: true, schema })}
          onOpenOverview={(schema) => openOverview(schema)}
          hasSchemas={activeConnection?.capabilities.hasSchemas ?? true}
          writable={!activeConnection?.capabilities.readOnly}
          pinnedKeys={pinnedKeys}
          onTogglePin={
            activeConnectionId
              ? (table) => togglePinned(activeConnectionId, `${table.schema}.${table.name}`)
              : undefined
          }
        />
      );
    }
    if (key === 'history') {
      return <QueryHistoryList connectionId={activeConnectionId} onSelect={loadQuery} />;
    }
    return <SnippetList onSelect={loadQuery} />;
  }

  return (
    <aside
      className={clsx(
        'relative hidden shrink-0 flex-col border-r border-border bg-surface-sunken md:flex',
        !isResizing && 'transition-[width] duration-150',
        collapsed && 'w-12',
      )}
      style={collapsed ? undefined : { width: sidebarWidth }}
    >
      {/* Connection header — active-connection button + dropdown, or expand button when collapsed. */}
      <div
        ref={connMenuRef}
        className={clsx('relative border-b border-border p-sm', collapsed && 'flex justify-center')}
      >
        {collapsed ? (
          <IconButton aria-label="Expand sidebar" title="Expand sidebar" onClick={() => setCollapsed(false)}>
            <PanelLeftOpen size={16} />
          </IconButton>
        ) : (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setConnMenuOpen((open) => !open)}
              aria-haspopup="listbox"
              aria-expanded={connMenuOpen}
              className="flex min-w-0 flex-1 items-center gap-sm rounded-sm p-1 text-left transition-colors hover:bg-surface-hover"
            >
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm bg-surface-hover text-accent">
                <Database size={14} />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-sm font-semibold leading-tight text-text">
                  {activeConnection?.name ?? 'No connection'}
                </h2>
                <p className="truncate text-xs leading-tight text-text-muted">
                  {activeConnection ? connectionEndpoint(activeConnection) : 'Select a connection'}
                </p>
              </div>
              <ChevronDown
                size={14}
                className={clsx('shrink-0 text-text-faint transition-transform', connMenuOpen && 'rotate-180')}
              />
            </button>
            <IconButton
              aria-label="New Connection"
              title="New Connection"
              onClick={() => {
                setConnMenuOpen(false);
                onNewConnection();
              }}
            >
              <Plus size={16} />
            </IconButton>
            <IconButton aria-label="Collapse sidebar" title="Collapse sidebar" onClick={() => setCollapsed(true)}>
              <PanelLeftClose size={16} />
            </IconButton>
          </div>
        )}

        {connMenuOpen && !collapsed ? (
          <div
            role="listbox"
            className="absolute inset-x-sm top-full z-30 mt-1 max-h-80 overflow-y-auto rounded-md border border-border bg-surface p-1 shadow-lg"
          >
            {connections.length === 0 ? (
              <p className="px-sm py-2 text-xs italic text-text-faint">No saved connections yet.</p>
            ) : (
              connections.map((connection) => {
                const isActive = connection.id === activeConnectionId;
                return (
                  <div key={connection.id} className="group relative">
                    <button
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      onClick={() => {
                        setActive(connection.id);
                        setConnMenuOpen(false);
                      }}
                      className={clsx(
                        'flex w-full items-center gap-sm rounded-sm border border-transparent p-sm pr-8 text-left transition-colors',
                        isActive ? 'bg-accent-muted text-accent' : 'text-text hover:bg-surface-hover',
                      )}
                    >
                      <Plug size={16} className={clsx('shrink-0', isActive ? 'text-accent' : 'text-text-faint')} />
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate text-sm">{connection.name}</span>
                        <span className="truncate font-mono text-xs text-text-faint">
                          {connectionEndpoint(connection)}
                        </span>
                      </div>
                      {connection.capabilities.readOnly ? (
                        <Badge variant="neutral" className="ml-auto shrink-0">
                          Read-only
                        </Badge>
                      ) : isActive ? (
                        <Check size={14} className="ml-auto shrink-0 text-accent" />
                      ) : null}
                    </button>
                    {connection.capabilities.readOnly ? null : (
                      <IconButton
                        aria-label={`Delete ${connection.name}`}
                        className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleDeleteConnection(connection);
                        }}
                      >
                        <Trash2 size={14} />
                      </IconButton>
                    )}
                  </div>
                );
              })
            )}
          </div>
        ) : null}
      </div>

      {collapsed ? (
        <div className="flex flex-col items-center gap-1 p-sm">
          {sidebarTabs.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              title={label}
              aria-label={label}
              onClick={() => openTab(key)}
              className={clsx(
                'flex h-8 w-8 items-center justify-center rounded-sm text-xs transition-colors',
                activeTab === key
                  ? 'bg-accent-muted text-accent'
                  : 'text-text-muted hover:bg-surface-hover hover:text-text',
              )}
            >
              <Icon size={16} />
            </button>
          ))}
        </div>
      ) : (
        // Accordion: each tab's header sits directly above its own collapsible panel.
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {sidebarTabs.map(({ key, label, icon: Icon }) => {
            const isActive = activeTab === key;
            return (
              <div key={key} className={clsx('flex min-h-0 flex-col border-b border-border', isActive && 'flex-1')}>
                <button
                  type="button"
                  onClick={() => openTab(key)}
                  aria-expanded={isActive}
                  className={clsx(
                    'flex shrink-0 items-center gap-sm px-sm py-2 text-xs font-medium transition-colors',
                    isActive ? 'text-text' : 'text-text-muted hover:bg-surface-hover hover:text-text',
                  )}
                >
                  <ChevronDown
                    size={14}
                    className={clsx('shrink-0 transition-transform', isActive ? '' : '-rotate-90')}
                  />
                  <Icon size={15} className="shrink-0" />
                  <span>{label}</span>
                </button>
                <div
                  className={clsx(
                    'grid min-h-0 transition-[grid-template-rows] duration-200 ease-out',
                    isActive ? 'flex-1 grid-rows-[1fr]' : 'grid-rows-[0fr]',
                  )}
                >
                  <div className="min-h-0 overflow-hidden">
                    <div className="h-full overflow-y-auto px-sm pb-1">{renderTabPanel(key)}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {confirmDialog}
      {activeConnectionId ? (
        <CreateTableModal
          open={createTableState.open}
          onClose={() => setCreateTableState((s) => ({ ...s, open: false }))}
          onSuccess={(schema, table) => openTable(schema, table, 'rows')}
          connectionId={activeConnectionId}
          initialSchema={createTableState.schema}
          schemas={(schemas ?? []).map((s) => s.name)}
        />
      ) : null}
      {collapsed ? null : (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          onPointerDown={onPointerDown}
          className="absolute right-0 top-0 z-10 h-full w-1 -translate-x-1/2 cursor-col-resize hover:bg-accent/50"
        />
      )}
    </aside>
  );
}
