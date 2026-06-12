import { useState } from 'react';
import { Code, Database, History, Network, Plus } from 'lucide-react';
import clsx from 'clsx';
import { Button } from '@prost/ui';
import { SchemaTree } from '../explorer/SchemaTree';
import { mockSchemas } from '../mocks/schema';

type SidebarTab = 'connections' | 'explorer' | 'history' | 'snippets';

const sidebarTabs: { key: SidebarTab; label: string; icon: typeof Database }[] = [
  { key: 'connections', label: 'Connections', icon: Database },
  { key: 'explorer', label: 'Explorer', icon: Network },
  { key: 'history', label: 'History', icon: History },
  { key: 'snippets', label: 'Snippets', icon: Code },
];

const placeholderText: Record<Exclude<SidebarTab, 'explorer'>, string> = {
  connections: 'No saved connections yet.',
  history: 'Query history will appear here.',
  snippets: 'Saved snippets will appear here.',
};

export interface SidebarProps {
  onNewConnection: () => void;
}

export function Sidebar({ onNewConnection }: SidebarProps) {
  const [activeTab, setActiveTab] = useState<SidebarTab>('explorer');
  const [selectedTable, setSelectedTable] = useState('users');

  return (
    <aside className="hidden w-sidebar shrink-0 flex-col border-r border-border bg-surface-sunken md:flex">
      <div className="flex items-center gap-sm border-b border-border p-sm">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm bg-surface-hover text-accent">
          <Database size={14} />
        </div>
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold leading-tight text-text">PostgreSQL</h2>
          <p className="truncate text-xs leading-tight text-text-muted">localhost:5432</p>
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
          <SchemaTree schemas={mockSchemas} selectedTable={selectedTable} onSelectTable={setSelectedTable} />
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
