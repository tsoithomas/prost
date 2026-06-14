import { Code, Plus, Table2, X } from 'lucide-react';
import clsx from 'clsx';

export interface WorkspaceTab {
  id: string;
  label: string;
  kind: 'table' | 'query';
}

export interface WorkspaceTabBarProps {
  tabs: WorkspaceTab[];
  activeTabId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNewTab: () => void;
}

export function WorkspaceTabBar({ tabs, activeTabId, onSelect, onClose, onNewTab }: WorkspaceTabBarProps) {
  const queryTabCount = tabs.filter((tab) => tab.kind === 'query').length;

  return (
    <div className="flex h-8 shrink-0 items-end gap-1 border-b border-border bg-surface-sunken px-sm pt-1">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        const Icon = tab.kind === 'table' ? Table2 : Code;
        const canClose = tab.kind !== 'query' || queryTabCount > 1;
        return (
          <div
            key={tab.id}
            className={clsx(
              'flex h-7 items-center gap-sm rounded-t-sm border border-b-0 px-sm text-xs transition-colors',
              isActive
                ? 'border-border border-b-2 border-b-accent bg-bg text-text'
                : 'border-transparent text-text-muted hover:bg-surface-hover hover:text-text',
            )}
          >
            <button type="button" onClick={() => onSelect(tab.id)} className="flex items-center gap-1">
              <Icon size={14} />
              {tab.label}
            </button>
            {canClose ? (
              <button
                type="button"
                aria-label={`Close ${tab.label}`}
                onClick={() => onClose(tab.id)}
                className="text-text-faint transition-colors hover:text-text"
              >
                <X size={12} />
              </button>
            ) : null}
          </div>
        );
      })}
      <button
        type="button"
        aria-label="New query tab"
        onClick={onNewTab}
        className="flex h-7 items-center rounded-t-sm px-sm text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
