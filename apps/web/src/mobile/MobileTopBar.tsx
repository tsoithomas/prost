import { useEffect, useRef, useState } from 'react';
import { Check, Database, Plug, Plus, Search } from 'lucide-react';
import clsx from 'clsx';
import { IconButton } from '@prost/ui';
import { useActiveConnection, useConnections } from '../api/connections';
import { connectionEndpoint } from '../connection/connectionDisplay';
import { useCommandPaletteStore } from '../stores/commandPaletteStore';
import { useConnectionStore } from '../stores/connectionStore';

export interface MobileTopBarProps {
  /** Opens the connection modal (used by the "New Connection" entry in the dropdown). */
  onOpenConnections: () => void;
}

export function MobileTopBar({ onOpenConnections }: MobileTopBarProps) {
  const activeConnection = useActiveConnection();
  const { data: connections = [] } = useConnections();
  const activeConnectionId = useConnectionStore((state) => state.activeConnectionId);
  const setActive = useConnectionStore((state) => state.setActive);
  const openPalette = useCommandPaletteStore((s) => s.openPalette);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLElement>(null);

  // Close the dropdown on outside tap / Escape (pointerdown covers both touch and mouse).
  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  return (
    <header ref={menuRef} className="relative flex h-12 shrink-0 items-center gap-sm border-b border-border bg-surface px-md">
      <button
        type="button"
        onClick={() => setMenuOpen((open) => !open)}
        aria-haspopup="listbox"
        aria-expanded={menuOpen}
        className="flex min-w-0 flex-1 items-center gap-sm self-stretch text-left"
      >
        <Database size={18} className="shrink-0 text-accent" />
        <span className="min-w-0 flex-1 truncate text-sm font-bold text-text">
          {activeConnection ? (
            <>
              {activeConnection.name} <span className="text-text-faint">/</span>{' '}
              {connectionEndpoint(activeConnection)}
            </>
          ) : (
            'No connection'
          )}
        </span>
      </button>
      <IconButton aria-label="Search" onClick={openPalette}>
        <Search size={18} />
      </IconButton>

      {menuOpen ? (
        <div
          role="listbox"
          className="absolute inset-x-2 top-full z-40 mt-1 max-h-[60vh] overflow-y-auto rounded-md border border-border bg-surface p-1 shadow-lg"
        >
          {connections.length === 0 ? (
            <p className="px-sm py-2 text-xs italic text-text-faint">No saved connections yet.</p>
          ) : (
            connections.map((connection) => {
              const isActive = connection.id === activeConnectionId;
              return (
                <button
                  key={connection.id}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  onClick={() => {
                    setActive(connection.id);
                    setMenuOpen(false);
                  }}
                  className={clsx(
                    'flex w-full items-center gap-sm rounded-sm p-sm text-left transition-colors',
                    isActive ? 'bg-accent-muted text-accent' : 'text-text hover:bg-surface-hover',
                  )}
                >
                  <Plug size={16} className={clsx('shrink-0', isActive ? 'text-accent' : 'text-text-faint')} />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm">{connection.name}</span>
                    <span className="truncate font-mono text-xs text-text-faint">
                      {connectionEndpoint(connection)}
                    </span>
                  </span>
                  {isActive ? <Check size={16} className="ml-auto shrink-0 text-accent" /> : null}
                </button>
              );
            })
          )}
          <div className="my-1 h-px bg-border" />
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              onOpenConnections();
            }}
            className="flex w-full items-center gap-sm rounded-sm p-sm text-left text-accent transition-colors hover:bg-surface-hover"
          >
            <Plus size={16} className="shrink-0" />
            <span className="text-sm font-medium">New Connection</span>
          </button>
        </div>
      ) : null}
    </header>
  );
}
