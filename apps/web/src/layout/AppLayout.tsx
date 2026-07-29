import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useConnections } from '../api/connections';
import { usePreferences } from '../api/preferences';
import { ConnectionModal } from '../connection/ConnectionModal';
import { DdlSuggestionHost } from '../ddl/DdlSuggestionHost';
import { useIsMobile } from '../hooks/useMediaQuery';
import { matchesChord, resolveBinding } from '../keybindings';
import { MobileShell } from '../mobile/MobileShell';
import { CommandPalette } from '../search/CommandPalette';
import { useCommandPaletteStore } from '../stores/commandPaletteStore';
import { useConnectionStore } from '../stores/connectionStore';
import { useThemeStore } from '../stores/themeStore';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { TopBar } from './TopBar';
import { Sidebar } from './Sidebar';
import { RightSidebar } from './RightSidebar';
import { SettingsModal } from './SettingsModal';
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
  const aiEnabled = useThemeStore((s) => s.aiEnabled);
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
    if (preferences.fontFamily !== store.fontFamily) store.setFontFamily(preferences.fontFamily);
    if (preferences.monoFontFamily !== store.monoFontFamily) store.setMonoFontFamily(preferences.monoFontFamily);
    if (preferences.radiusScale && preferences.radiusScale !== store.radiusScale) {
      store.setRadiusScale(preferences.radiusScale);
    }
    store.setDataColors(preferences.dataColors ?? {});
    store.setEditorPrefs(preferences.editor ?? {});
    store.setGridPrefs(preferences.grid ?? {});
    store.setBehaviorPrefs(preferences.behavior ?? {});
    store.setReduceMotion(preferences.reduceMotion ?? false);
    store.setAiEnabled(preferences.aiEnabled ?? true);
    // The workspace's "transactional by default" is a preference; seed the runtime flag from it.
    if (preferences.behavior?.transactionByDefault !== undefined) {
      useWorkspaceStore.getState().setTransactionalDefault(preferences.behavior.transactionByDefault);
    }
  }, [preferences]);

  // Startup connection: once preferences + connections have loaded, apply the user's choice exactly
  // once — 'last'/unset keeps the persisted connection, 'none' clears it, an id selects that connection.
  const { data: connections } = useConnections();
  const startupAppliedRef = useRef(false);
  useEffect(() => {
    if (!preferences || !connections || startupAppliedRef.current) return;
    startupAppliedRef.current = true;
    const startup = preferences.behavior?.startupConnection;
    if (!startup || startup === 'last') return;
    const connStore = useConnectionStore.getState();
    if (startup === 'none') connStore.setActive(null);
    else if (connections.some((c) => c.id === startup)) connStore.setActive(startup);
  }, [preferences, connections]);

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
        <DdlSuggestionHost />
        <SettingsModal />
      </>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-bg text-text">
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar onNewConnection={openConnectionModal} />
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
        {aiEnabled ? <RightSidebar /> : null}
      </div>
      <StatusBar />
      {connectionModal}
      <CommandPalette />
      <DdlSuggestionHost />
      <SettingsModal />
    </div>
  );
}
