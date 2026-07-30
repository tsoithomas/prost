import { Bot, Network, Settings, Terminal } from 'lucide-react';
import clsx from 'clsx';
import { useThemeStore } from '../stores/themeStore';
import type { MobileTab } from './MobileShell';

const tabs: { key: MobileTab; label: string; icon: typeof Network }[] = [
  { key: 'explorer', label: 'Explorer', icon: Network },
  { key: 'editor', label: 'Editor', icon: Terminal },
  { key: 'ai', label: 'AI', icon: Bot },
  { key: 'settings', label: 'Settings', icon: Settings },
];

export interface MobileBottomNavProps {
  active: MobileTab;
  onChange: (tab: MobileTab) => void;
}

export function MobileBottomNav({ active, onChange }: MobileBottomNavProps) {
  const aiEnabled = useThemeStore((s) => s.aiEnabled);
  const visibleTabs = aiEnabled ? tabs : tabs.filter((t) => t.key !== 'ai');
  return (
    <nav
      aria-label="Primary"
      className="flex min-h-14 shrink-0 items-center justify-around border-t border-border bg-surface-sunken px-sm pt-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)]"
    >
      {visibleTabs.map(({ key, label, icon: Icon }) => {
        const isActive = key === active;
        return (
          <button
            key={key}
            type="button"
            aria-current={isActive ? 'page' : undefined}
            aria-label={label}
            onClick={() => onChange(key)}
            className="flex h-full flex-1 flex-col items-center justify-center gap-0.5 text-xs"
          >
            <span
              className={clsx(
                'flex items-center justify-center transition-colors',
                isActive ? 'text-accent' : 'text-text-muted',
              )}
            >
              <Icon size={24} />
            </span>
            <span className={isActive ? 'font-medium text-accent' : 'text-text-muted'}>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
