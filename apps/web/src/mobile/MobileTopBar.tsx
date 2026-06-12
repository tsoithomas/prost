import { Database, Network } from 'lucide-react';
import { IconButton } from '@prost/ui';
import type { MobileTab } from './MobileShell';

export interface MobileTopBarProps {
  activeTab: MobileTab;
  onOpenConnections: () => void;
  onShowExplorer: () => void;
}

export function MobileTopBar({ activeTab, onOpenConnections, onShowExplorer }: MobileTopBarProps) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-sm border-b border-border bg-surface px-md">
      <IconButton aria-label="Connections" onClick={onOpenConnections}>
        <Database size={18} />
      </IconButton>
      <h1 className="flex-1 truncate text-sm font-bold text-text">
        PostgreSQL <span className="text-text-faint">/</span> localhost:5432
      </h1>
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
