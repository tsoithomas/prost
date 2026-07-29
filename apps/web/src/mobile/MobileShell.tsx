import { useEffect, useState } from 'react';
import { ChatPanel } from '../ai/ChatPanel';
import { useAiStore } from '../stores/aiStore';
import { useConnectionStore } from '../stores/connectionStore';
import { useThemeStore } from '../stores/themeStore';
import { Workspace } from '../workspace/Workspace';
import { MobileBottomNav } from './MobileBottomNav';
import { MobileExplorerView } from './MobileExplorerView';
import { MobileSettingsView } from './MobileSettingsView';
import { MobileTopBar } from './MobileTopBar';

export type MobileTab = 'explorer' | 'editor' | 'ai' | 'settings';

export interface MobileShellProps {
  onOpenConnections: () => void;
}

export function MobileShell({ onOpenConnections }: MobileShellProps) {
  const [activeTab, setActiveTab] = useState<MobileTab>('explorer');
  const activeConnectionId = useConnectionStore((state) => state.activeConnectionId);
  const pendingChatPrompt = useAiStore((state) => state.pendingChatPrompt);
  const aiEnabled = useThemeStore((state) => state.aiEnabled);

  // "Fix/Explain with AI" queues a chat prompt via aiStore (which opens the desktop right sidebar).
  // On mobile there's no sidebar — switch to the AI tab so the queued prompt is visible + auto-sent.
  useEffect(() => {
    if (pendingChatPrompt !== null && aiEnabled) setActiveTab('ai');
  }, [pendingChatPrompt, aiEnabled]);

  // If the AI assistant is disabled while its tab is open, fall back to the editor.
  useEffect(() => {
    if (!aiEnabled && activeTab === 'ai') setActiveTab('editor');
  }, [aiEnabled, activeTab]);

  return (
    <div className="flex h-screen flex-col bg-bg text-text">
      <MobileTopBar onOpenConnections={onOpenConnections} />
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {activeTab === 'explorer' ? <MobileExplorerView onSelectTable={() => setActiveTab('editor')} /> : null}
        {activeTab === 'editor' ? <Workspace /> : null}
        {activeTab === 'ai' ? (
          activeConnectionId ? (
            <ChatPanel connectionId={activeConnectionId} />
          ) : (
            <p className="px-md py-lg text-center text-sm italic text-text-faint">
              Select a connection to use AI Chat.
            </p>
          )
        ) : null}
        {activeTab === 'settings' ? (
          <MobileSettingsView
            onManageConnections={onOpenConnections}
            onSelectHistoryQuery={() => setActiveTab('editor')}
            onSelectSnippet={() => setActiveTab('editor')}
            onOpenSessions={() => setActiveTab('editor')}
            onOpenAudit={() => setActiveTab('editor')}
          />
        ) : null}
      </main>
      <MobileBottomNav active={activeTab} onChange={setActiveTab} />
    </div>
  );
}
