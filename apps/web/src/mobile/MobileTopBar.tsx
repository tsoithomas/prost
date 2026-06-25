import { Database, Network, Search } from 'lucide-react';
import { IconButton } from '@prost/ui';
import { useActiveConnection } from '../api/connections';
import { connectionEndpoint } from '../connection/connectionDisplay';
import { useCommandPaletteStore } from '../stores/commandPaletteStore';
import type { MobileTab } from './MobileShell';

export interface MobileTopBarProps {
  activeTab: MobileTab;
  onOpenConnections: () => void;
  onShowExplorer: () => void;
}

export function MobileTopBar({ activeTab, onOpenConnections, onShowExplorer }: MobileTopBarProps) {
  const activeConnection = useActiveConnection();
  const openPalette = useCommandPaletteStore((s) => s.openPalette);

  return (
    <header className="flex h-12 shrink-0 items-center gap-sm border-b border-border bg-surface px-md">
      <IconButton aria-label="Connections" onClick={onOpenConnections}>
        <Database size={18} />
      </IconButton>
      <h1 className="flex-1 truncate text-sm font-bold text-text">
        {activeConnection ? (
          <>
            {activeConnection.name} <span className="text-text-faint">/</span>{' '}
            {connectionEndpoint(activeConnection)}
          </>
        ) : (
          'No connection'
        )}
      </h1>
      <IconButton aria-label="Search" onClick={openPalette}>
        <Search size={18} />
      </IconButton>
      <IconButton
        aria-label="Schema explorer"
        variant={activeTab === 'explorer' ? 'active' : 'ghost'}
        onClick={onShowExplorer}
      >
        <Network size={18} />
      </IconButton>
    </header>
  );
}
