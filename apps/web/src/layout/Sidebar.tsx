import { useState } from 'react';
import { Code, Database, History, Network, Plus } from 'lucide-react';
import clsx from 'clsx';
import { Button } from '@prost/ui';
import { useActiveConnection } from '../api/connections';
import { useQueryHistory } from '../api/history';
import { useMetadata } from '../api/metadata';
import { QueryHistoryList } from '../explorer/QueryHistoryList';
import { SchemaTree } from '../explorer/SchemaTree';
import { useConnectionStore } from '../stores/connectionStore';
import { useWorkspaceStore } from '../stores/workspaceStore';

type SidebarTab = 'connections' | 'explorer' | 'history' | 'snippets';

const sidebarTabs: { key: SidebarTab; label: string; icon: typeof Database }[] = [
  { key: 'connections', label: 'Connections', icon: Database },
  { key: 'explorer', label: 'Explorer', icon: Network },
  { key: 'history', label: 'History', icon: History },
  { key: 'snippets', label: 'Snippets', icon: Code },
];

const placeholderText: Record<Exclude<SidebarTab, 'explorer' | 'history'>, string> = {
  connections: 'No saved connections yet.',
  snippets: 'Saved snippets will appear here.',
};

export interface SidebarProps {
  onNewConnection: () => void;
}

export function Sidebar({ onNewConnection }: SidebarProps) {
  const [activeTab, setActiveTab] = useState<SidebarTab>('explorer');
  const activeConnectionId = useConnectionStore((state) => state.activeConnectionId);
  const activeConnection = useActiveConnection();
  const { data: schemas, isLoading, isError } = useMetadata(activeConnectionId);
  const { data: history, isLoading: isHistoryLoading, isError: isHistoryError } = useQueryHistory(activeConnectionId);
  const workspaceTabs = useWorkspaceStore((state) => state.tabs);
  const activeWorkspaceTabId = useWorkspaceStore((state) => state.activeTabId);
  const openTable = useWorkspaceStore((state) => state.openTable);
  const loadQuery = useWorkspaceStore((state) => state.loadQuery);

  const activeWorkspaceTab = workspaceTabs.find((tab) => tab.id === activeWorkspaceTabId);
  const selectedTable =
    activeWorkspaceTab?.kind === 'table' && activeWorkspaceTab.schema
      ? `${activeWorkspaceTab.schema}.${activeWorkspaceTab.table}`
      : null;

  return (
    <aside className="hidden w-sidebar shrink-0 flex-col border-r border-border bg-surface-sunken md:flex">
      <div className="flex items-center gap-sm border-b border-border p-sm">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm bg-surface-hover text-accent">
          <Database size={14} />
        </div>
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold leading-tight text-text">
            {activeConnection?.name ?? 'No connection'}
          </h2>
          <p className="truncate text-xs leading-tight text-text-muted">
            {activeConnection ? `${activeConnection.host}:${activeConnection.port}` : 'Select a connection'}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-1 p-sm">
        {sidebarTabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveTab(key)}
            className={clsx(
              'flex items-center gap-sm rounded-sm px-sm py-1.5 text-xs transition-colors',
              activeTab === key
                ? 'bg-accent-muted text-accent'
                : 'text-text-muted hover:bg-surface-hover hover:text-text',
            )}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-sm py-1">
        {activeTab === 'explorer' ? (
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
              onSelectTable={(table) => openTable(table.schema, table.name)}
            />
          )
        ) : activeTab === 'history' ? (
          activeConnectionId === null ? (
            <p className="px-sm py-2 text-xs italic text-text-faint">
              No active connection. Use "New Connection" to get started.
            </p>
          ) : (
            <QueryHistoryList
              items={history}
              isLoading={isHistoryLoading}
              isError={isHistoryError}
              onSelect={loadQuery}
            />
          )
        ) : (
          <p className="px-sm py-2 text-xs italic text-text-faint">{placeholderText[activeTab]}</p>
        )}
      </div>

      <div className="border-t border-border p-sm">
        <Button variant="secondary" size="sm" className="w-full justify-center" onClick={onNewConnection}>
          <Plus size={14} />
          New Connection
        </Button>
      </div>
    </aside>
  );
}
