import { Network, Settings, Terminal } from 'lucide-react';
import clsx from 'clsx';
import type { MobileTab } from './MobileShell';

const tabs: { key: MobileTab; label: string; icon: typeof Network }[] = [
  { key: 'explorer', label: 'Explorer', icon: Network },
  { key: 'editor', label: 'Editor', icon: Terminal },
  { key: 'settings', label: 'Settings', icon: Settings },
];

export interface MobileBottomNavProps {
  active: MobileTab;
  onChange: (tab: MobileTab) => void;
}

export function MobileBottomNav({ active, onChange }: MobileBottomNavProps) {
  return (
    <nav className="flex min-h-14 shrink-0 items-center justify-around border-t border-border bg-surface-sunken px-sm pb-[env(safe-area-inset-bottom)]">
      {tabs.map(({ key, label, icon: Icon }) => {
        const isActive = key === active;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            className="flex h-full flex-1 flex-col items-center justify-center gap-0.5 text-xs"
          >
            <span
              className={clsx(
                'flex h-11 w-12 items-center justify-center rounded-full transition-colors',
                isActive ? 'bg-accent-muted text-accent' : 'text-text-muted',
              )}
            >
              <Icon size={20} />
            </span>
            <span className={isActive ? 'font-medium text-accent' : 'text-text-muted'}>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
