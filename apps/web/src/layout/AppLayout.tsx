import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { usePreferences } from '../api/preferences';
import { ConnectionModal } from '../connection/ConnectionModal';
import { useIsMobile } from '../hooks/useMediaQuery';
import { matchesChord, resolveBinding } from '../keybindings';
import { MobileShell } from '../mobile/MobileShell';
import { CommandPalette } from '../search/CommandPalette';
import { useCommandPaletteStore } from '../stores/commandPaletteStore';
import { useConnectionStore } from '../stores/connectionStore';
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

  // Global command-palette shortcut (remappable; defaults to ⌘K / Ctrl+K), both shells.
  const togglePalette = useCommandPaletteStore((s) => s.toggle);
  const keybindings = useThemeStore((s) => s.keybindings);
  useEffect(() => {
    const chord = resolveBinding('command-palette', keybindings);
    function handleKeyDown(e: KeyboardEvent) {
      if (matchesChord(e, chord)) {
        e.preventDefault();
        togglePalette();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePalette, keybindings]);

  // Server preferences win over localStorage once authenticated — reconciles the device
  // with a saved choice exactly once per session, without clobbering later user edits.
  const { data: preferences } = usePreferences();
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (!preferences || hydratedRef.current) return;
    hydratedRef.current = true;
    const store = useThemeStore.getState();
    if (preferences.colorMode !== store.colorMode) store.setColorMode(preferences.colorMode);
    if (preferences.accentColor !== store.accentColor) store.setAccentColor(preferences.accentColor);
    if (preferences.fontSize && preferences.fontSize !== store.fontSize) store.setFontSize(preferences.fontSize);
    if (preferences.gridDensity && preferences.gridDensity !== store.gridDensity) {
      store.setGridDensity(preferences.gridDensity);
    }
    store.setCustomPalettes(preferences.customPalettes ?? []);
    store.setKeybindings(preferences.keybindings ?? {});
    store.setConnectionOverrides(preferences.connectionOverrides ?? {});
    store.setColumnRenderOverrides(preferences.columnRenderOverrides ?? {});
  }, [preferences]);

  // Apply the active connection's theme override (or revert to the global theme) on switch,
  // and re-resolve once overrides arrive from the server.
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId);
  const connectionOverrides = useThemeStore((s) => s.connectionOverrides);
  const applyConnectionTheme = useThemeStore((s) => s.applyConnectionTheme);
  useEffect(() => {
    applyConnectionTheme(activeConnectionId);
  }, [activeConnectionId, connectionOverrides, applyConnectionTheme]);

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
