import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { usePreferences } from '../api/preferences';
import { ConnectionModal } from '../connection/ConnectionModal';
import { useIsMobile } from '../hooks/useMediaQuery';
import { MobileShell } from '../mobile/MobileShell';
import { CommandPalette } from '../search/CommandPalette';
import { useCommandPaletteStore } from '../stores/commandPaletteStore';
import { useThemeStore } from '../stores/themeStore';
import { TopBar } from './TopBar';
import { Sidebar } from './Sidebar';
import { RightSidebar } from './RightSidebar';
import { StatusBar } from './StatusBar';

export interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const [connectionModalOpen, setConnectionModalOpen] = useState(false);
  const isMobile = useIsMobile();
  const openConnectionModal = () => setConnectionModalOpen(true);
  const connectionModal = <ConnectionModal open={connectionModalOpen} onClose={() => setConnectionModalOpen(false)} />;

  // Global ⌘K / Ctrl+K toggles the command palette (both shells).
  const togglePalette = useCommandPaletteStore((s) => s.toggle);
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        togglePalette();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePalette]);

  // Server preferences win over localStorage once authenticated — reconciles the device
  // with a saved choice exactly once per session, without clobbering later user edits.
  const { data: preferences } = usePreferences();
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (!preferences || hydratedRef.current) return;
    hydratedRef.current = true;
    const { colorMode, accentColor, setColorMode, setAccentColor } = useThemeStore.getState();
    if (preferences.colorMode !== colorMode) setColorMode(preferences.colorMode);
    if (preferences.accentColor !== accentColor) setAccentColor(preferences.accentColor);
  }, [preferences]);

  if (isMobile) {
    return (
      <>
        <MobileShell onOpenConnections={openConnectionModal} />
        {connectionModal}
        <CommandPalette />
      </>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-bg text-text">
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar onNewConnection={openConnectionModal} />
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
        <RightSidebar />
      </div>
      <StatusBar />
      {connectionModal}
      <CommandPalette />
    </div>
  );
}
