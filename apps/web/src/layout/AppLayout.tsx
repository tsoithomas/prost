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
import { useAiStore } from '../stores/aiStore';
import { useCommandPaletteStore } from '../stores/commandPaletteStore';
import { useConnectionStore } from '../stores/connectionStore';
import { useLayoutStore } from '../stores/layoutStore';
import { useShortcutsStore } from '../stores/shortcutsStore';
import { useThemeStore } from '../stores/themeStore';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { FocusModeExit } from './FocusModeExit';
import { TopBar } from './TopBar';
import { Sidebar } from './Sidebar';
import { RightSidebar } from './RightSidebar';
import { SettingsModal } from './SettingsModal';
import { ShortcutsHelp } from './ShortcutsHelp';
import { StatusBar } from './StatusBar';

export interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const [connectionModalOpen, setConnectionModalOpen] = useState(false);
  const isMobile = useIsMobile();
  const openConnectionModal = () => setConnectionModalOpen(true);
  const connectionModal = <ConnectionModal open={connectionModalOpen} onClose={() => setConnectionModalOpen(false)} />;

  // Global keyboard shortcuts (remappable; both shells). Palette/shortcuts toggle; new/close tab act
  // on the workspace store. Reads store state lazily in the handler to avoid stale closures.
  const togglePalette = useCommandPaletteStore((s) => s.toggle);
  const toggleShortcuts = useShortcutsStore((s) => s.toggleShortcuts);
  const keybindings = useThemeStore((s) => s.keybindings);
  const aiEnabled = useThemeStore((s) => s.aiEnabled);
  useEffect(() => {
    // A bare `?` is a fixed alias for the shortcuts overlay (not in the registry — `chordFromEvent`
    // rejects modifier-less chords by design, so it can't be remapped/recorded like the others).
    function isBareHelpKey(e: KeyboardEvent): boolean {
      return e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey;
    }
    // Chords that would shadow native browser/input behavior (find-in-page, copy) only fire the
    // app action when focus isn't inside a text field or the Monaco editor, which own those keys.
    const TEXT_INPUT_GUARDED = new Set(['find-in-grid', 'copy-cells']);
    function isTextInputFocused(): boolean {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return false;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) return true;
      return !!el.closest('.monaco-editor');
    }
    function cycleTab(direction: 1 | -1) {
      const ws = useWorkspaceStore.getState();
      const { tabs, activeTabId } = ws;
      if (tabs.length < 2) return;
      const idx = tabs.findIndex((tab) => tab.id === activeTabId);
      const next = tabs[(idx + direction + tabs.length) % tabs.length];
      if (next) ws.selectTab(next.id);
    }
    const bindings: [string, () => void][] = [
      ['command-palette', () => togglePalette()],
      ['show-shortcuts', () => toggleShortcuts()],
      ['new-query-tab', () => useWorkspaceStore.getState().newQueryTab()],
      ['close-tab', () => {
        const ws = useWorkspaceStore.getState();
        if (ws.activeTabId) ws.closeTab(ws.activeTabId);
      }],
      ['next-tab', () => cycleTab(1)],
      ['prev-tab', () => cycleTab(-1)],
      ['focus-editor', () => useWorkspaceStore.getState().requestFocus('editor')],
      ['focus-results', () => useWorkspaceStore.getState().requestFocus('results')],
      ['toggle-left-sidebar', () => useLayoutStore.getState().toggleLeftSidebarCollapsed()],
      ['toggle-ai-sidebar', () => useAiStore.getState().toggleRightSidebar()],
      ['toggle-focus-mode', () => useLayoutStore.getState().toggleFocusMode()],
      // Global (not grid-scoped, unlike find-in-grid/copy-cells/save-edits below): refreshing the
      // current view is a reasonable thing to want regardless of where focus happens to be, the same
      // way browser refresh isn't scoped to a focused element. Routes through the same one-shot
      // `viewActionRequest` hand-off the command palette's "Refresh current view" already uses.
      ['refresh-view', () => useWorkspaceStore.getState().requestViewAction('refresh')],
    ];
    function handleKeyDown(e: KeyboardEvent) {
      if (isBareHelpKey(e) && !isTextInputFocused()) {
        e.preventDefault();
        toggleShortcuts();
        return;
      }
      for (const [action, run] of bindings) {
        if (TEXT_INPUT_GUARDED.has(action) && isTextInputFocused()) continue;
        if (matchesChord(e, resolveBinding(action, keybindings))) {
          e.preventDefault();
          run();
          return;
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePalette, toggleShortcuts, keybindings]);

  // Focus mode (Phase 40): hides the top bar, both sidebars, and the status bar so the workspace has
  // the full viewport; `Escape` is a second way out besides the shortcut/floating restore button.
  const focusMode = useLayoutStore((s) => s.focusMode);
  const setFocusMode = useLayoutStore((s) => s.setFocusMode);
  useEffect(() => {
    if (!focusMode) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setFocusMode(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [focusMode, setFocusMode]);

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
    store.setMaskedColumns(preferences.maskedColumns ?? {});
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
    store.setHideFocusRing(preferences.hideFocusRing ?? true);
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
        <ShortcutsHelp />
      </>
    );
  }

  return (
    <div className="relative flex h-screen flex-col bg-bg text-text">
      {focusMode ? null : <TopBar />}
      <div className="flex flex-1 overflow-hidden">
        {focusMode ? null : <Sidebar onNewConnection={openConnectionModal} />}
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
        {focusMode ? null : aiEnabled ? <RightSidebar /> : null}
      </div>
      {focusMode ? null : <StatusBar />}
      {focusMode ? <FocusModeExit onExit={() => setFocusMode(false)} /> : null}
      {connectionModal}
      <CommandPalette />
      <DdlSuggestionHost />
      <SettingsModal />
      <ShortcutsHelp />
    </div>
  );
}
