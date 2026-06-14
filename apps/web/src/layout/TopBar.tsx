import { useState } from 'react';
import { Bot, Settings } from 'lucide-react';
import { IconButton } from '@prost/ui';
import logo from '../assets/logo.svg';
import { useAiStore } from '../stores/aiStore';
import { SettingsPanel } from './SettingsPanel';

export function TopBar() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const rightSidebarOpen = useAiStore((s) => s.rightSidebarOpen);
  const toggleRightSidebar = useAiStore((s) => s.toggleRightSidebar);

  return (
    <header className="flex h-8 shrink-0 items-center justify-between border-b border-border bg-surface px-md">
      <span className="flex items-center gap-xs text-sm font-bold text-accent">
        <img src={logo} alt="" className="h-5 w-5" />
        Prost
      </span>
      <div className="flex items-center gap-xs">
        <IconButton
          aria-label="Toggle AI chat"
          title="Toggle AI chat"
          variant={rightSidebarOpen ? 'active' : 'ghost'}
          onClick={toggleRightSidebar}
        >
          <Bot size={16} />
        </IconButton>
        <div className="relative">
          <IconButton
            aria-label="Settings"
            variant={settingsOpen ? 'active' : 'ghost'}
            onClick={() => setSettingsOpen((open) => !open)}
          >
            <Settings size={16} />
          </IconButton>
          {settingsOpen ? <SettingsPanel onClose={() => setSettingsOpen(false)} /> : null}
        </div>
      </div>
    </header>
  );
}
