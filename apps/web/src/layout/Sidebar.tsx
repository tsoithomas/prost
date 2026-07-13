import { useState } from 'react';
import { Code, Database, History, Network, PanelLeftClose, PanelLeftOpen, Plug, Plus, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import type { ConnectionDto } from '@prost/shared-types';
import { Badge, Button, IconButton } from '@prost/ui';
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
import { useWorkspaceStore } from '../stores/workspaceStore';

type SidebarTab = 'connections' | 'explorer' | 'history' | 'snippets';

const sidebarTabs: { key: SidebarTab; label: string; icon: typeof Database }[] = [
  { key: 'connections', label: 'Connections', icon: Database },
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

  return (
    <aside
      className={clsx(
        'relative hidden shrink-0 flex-col border-r border-border bg-surface-sunken md:flex',
        !isResizing && 'transition-[width] duration-150',
        collapsed && 'w-12',
      )}
      style={collapsed ? undefined : { width: sidebarWidth }}
    >
      <div className={clsx('flex items-center gap-sm border-b border-border p-sm', collapsed && 'justify-center')}>
        {collapsed ? (
          <IconButton aria-label="Expand sidebar" title="Expand sidebar" onClick={() => setCollapsed(false)}>
            <PanelLeftOpen size={16} />
          </IconButton>
        ) : (
          <>
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
            <IconButton aria-label="Collapse sidebar" title="Collapse sidebar" onClick={() => setCollapsed(true)}>
              <PanelLeftClose size={16} />
            </IconButton>
          </>
        )}
      </div>

      <div className={clsx('flex flex-col gap-1 p-sm', collapsed && 'items-center')}>
        {sidebarTabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            title={label}
            aria-label={label}
            onClick={() => {
              setActiveTab(key);
              if (collapsed) setCollapsed(false);
            }}
            className={clsx(
              'flex items-center gap-sm rounded-sm text-xs transition-colors',
              collapsed ? 'h-8 w-8 justify-center' : 'px-sm py-1.5',
              activeTab === key
                ? 'bg-accent-muted text-accent'
                : 'text-text-muted hover:bg-surface-hover hover:text-text',
            )}
          >
            <Icon size={16} />
            {!collapsed ? label : null}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-sm pb-1">
        {collapsed ? null : activeTab === 'explorer' ? (
          activeConnectionId === null ? (
            <p className="px-sm py-2 text-xs italic text-text-faint">
              No active connection. Use "New Connection" to get started.
            </p>
          ) : isLoading ? (
            <p className="px-sm py-2 text-xs italic text-text-faint">Loading schemas…</p>
          ) : isError ? (
            <p className="px-sm py-2 text-xs text-danger">Failed to load schemas.</p>
          ) : (
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
            />
          )
        ) : activeTab === 'history' ? (
          <QueryHistoryList connectionId={activeConnectionId} onSelect={loadQuery} />
        ) : activeTab === 'connections' ? (
          connections.length === 0 ? (
            <p className="px-sm py-2 text-xs italic text-text-faint">No saved connections yet.</p>
          ) : (
            <div className="space-y-1">
              {connections.map((connection) => {
                const isActive = connection.id === activeConnectionId;
                return (
                  <div key={connection.id} className="group relative">
                    <button
                      type="button"
                      onClick={() => setActive(connection.id)}
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
                        <Badge variant="success" className="ml-auto shrink-0">
                          Active
                        </Badge>
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
              })}
            </div>
          )
        ) : activeTab === 'snippets' ? (
          <SnippetList onSelect={loadQuery} />
        ) : null}
      </div>

      <div className={clsx('border-t border-border p-sm', collapsed && 'flex justify-center')}>
        {collapsed ? (
          <IconButton aria-label="New Connection" title="New Connection" onClick={onNewConnection}>
            <Plus size={14} />
          </IconButton>
        ) : (
          <Button variant="secondary" size="sm" className="w-full justify-center" onClick={onNewConnection}>
            <Plus size={14} />
            New Connection
          </Button>
        )}
      </div>
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
