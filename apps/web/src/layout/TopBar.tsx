import { useState } from 'react';
import { Play, Save, Search, Settings, Share2 } from 'lucide-react';
import clsx from 'clsx';
import { Button, IconButton } from '@prost/ui';
import { SettingsPanel } from './SettingsPanel';

const navLinks = ['Query', 'Design', 'Import', 'Export'];

export function TopBar() {
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <header className="flex h-8 shrink-0 items-center justify-between border-b border-border bg-surface px-md">
      <div className="flex items-center gap-lg">
        <span className="text-sm font-bold text-accent">Prost</span>
        <nav className="hidden items-center gap-1 text-xs md:flex">
          {navLinks.map((label, index) => (
            <a
              key={label}
              href="#"
              className={clsx(
                'rounded-sm px-sm py-1 transition-colors',
                index === 0
                  ? 'text-accent'
                  : 'text-text-muted hover:bg-surface-hover hover:text-text',
              )}
            >
              {label}
            </a>
          ))}
        </nav>
      </div>
      <div className="flex items-center gap-sm">
        <div className="hidden h-6 items-center overflow-hidden rounded-sm border border-border bg-surface-raised sm:flex">
          <span className="flex h-full items-center border-r border-border px-xs text-text-faint">
            <Search size={14} />
          </span>
          <input
            type="search"
            aria-label="Search"
            placeholder="Search..."
            className="h-full w-48 bg-transparent px-sm text-xs text-text placeholder:text-text-faint focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-1 border-r border-border pr-sm">
          <IconButton aria-label="Run query">
            <Play size={16} />
          </IconButton>
          <IconButton aria-label="Save">
            <Save size={16} />
          </IconButton>
          <IconButton aria-label="Share">
            <Share2 size={16} />
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
        <Button variant="secondary" size="sm">
          Save
        </Button>
        <Button variant="primary" size="sm">
          <Play size={12} />
          Run
        </Button>
      </div>
    </header>
  );
}
