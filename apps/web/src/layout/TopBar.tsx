import { Settings } from 'lucide-react';
import { IconButton } from '@prost/ui';
import logo from '../assets/logo.svg';
import { useSettingsStore } from '../stores/settingsStore';

export function TopBar() {
  const openSettings = useSettingsStore((state) => state.openSettings);

  return (
    <header className="flex h-8 shrink-0 items-center justify-between border-b border-border bg-surface px-md">
      <span className="flex items-center gap-xs text-sm font-bold text-accent">
        <img src={logo} alt="" className="h-5 w-5" />
        Prost
      </span>
      <div className="flex items-center gap-xs">
        <IconButton aria-label="Settings" variant="ghost" onClick={() => openSettings()}>
          <Settings size={16} />
        </IconButton>
      </div>
    </header>
  );
}
