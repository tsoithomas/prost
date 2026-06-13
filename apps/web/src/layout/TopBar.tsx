import { useState } from 'react';
import { Settings } from 'lucide-react';
import { IconButton } from '@prost/ui';
import { SettingsPanel } from './SettingsPanel';

export function TopBar() {
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <header className="flex h-8 shrink-0 items-center justify-between border-b border-border bg-surface px-md">
      <span className="text-sm font-bold text-accent">Prost</span>
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
    </header>
  );
}
