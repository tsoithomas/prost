import { useState } from 'react';
import { Workspace } from '../workspace/Workspace';
import { MobileBottomNav } from './MobileBottomNav';
import { MobileExplorerView } from './MobileExplorerView';
import { MobileSettingsView } from './MobileSettingsView';
import { MobileTopBar } from './MobileTopBar';

export type MobileTab = 'explorer' | 'editor' | 'settings';

export interface MobileShellProps {
  onOpenConnections: () => void;
}

export function MobileShell({ onOpenConnections }: MobileShellProps) {
  const [activeTab, setActiveTab] = useState<MobileTab>('explorer');

  return (
    <div className="flex h-screen flex-col bg-bg text-text">
      <MobileTopBar
        activeTab={activeTab}
        onOpenConnections={onOpenConnections}
        onShowExplorer={() => setActiveTab('explorer')}
      />
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {activeTab === 'explorer' ? <MobileExplorerView onSelectTable={() => setActiveTab('editor')} /> : null}
        {activeTab === 'editor' ? <Workspace /> : null}
        {activeTab === 'settings' ? <MobileSettingsView onManageConnections={onOpenConnections} /> : null}
      </main>
      <MobileBottomNav active={activeTab} onChange={setActiveTab} />
    </div>
  );
}
