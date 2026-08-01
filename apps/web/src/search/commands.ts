import { useMemo } from 'react';
import { resolveColorMode } from '@prost/ui';
import { formatChord, resolveBinding } from '../keybindings';
import { useAiStore } from '../stores/aiStore';
import { useConnectionStore } from '../stores/connectionStore';
import { useLayoutStore } from '../stores/layoutStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useShortcutsStore } from '../stores/shortcutsStore';
import { useThemeStore } from '../stores/themeStore';
import { useWorkspaceStore } from '../stores/workspaceStore';

/**
 * An app action surfaced in the command palette (Phase 40) — navigation/UI only, never a command
 * that executes SQL or mutates data (the palette's existing "never auto-runs a query" posture, §4/§8).
 */
export interface CommandItem {
  id: string;
  label: string;
  run: () => void;
  /** The resolved chord to show alongside the label, if this command has a remappable shortcut. */
  shortcut?: string;
}

/** Builds the fixed set of app-level commands, resolved against current store state. */
export function useCommands(): CommandItem[] {
  const keybindings = useThemeStore((s) => s.keybindings);
  const colorMode = useThemeStore((s) => s.colorMode);
  const setColorMode = useThemeStore((s) => s.setColorMode);
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId);
  const activeTab = useWorkspaceStore((s) => s.tabs.find((tab) => tab.id === s.activeTabId));
  const hasMultipleTabs = useWorkspaceStore((s) => s.tabs.length > 1);

  const chordFor = (actionId: string) => formatChord(resolveBinding(actionId, keybindings));

  return useMemo<CommandItem[]>(() => {
    const items: CommandItem[] = [
      {
        id: 'new-query-tab',
        label: 'New query tab',
        shortcut: chordFor('new-query-tab'),
        run: () => useWorkspaceStore.getState().newQueryTab(),
      },
      {
        id: 'close-tab',
        label: 'Close current tab',
        shortcut: chordFor('close-tab'),
        run: () => {
          const ws = useWorkspaceStore.getState();
          if (ws.activeTabId) ws.closeTab(ws.activeTabId);
        },
      },
      {
        id: 'toggle-focus-mode',
        label: 'Toggle focus mode',
        shortcut: chordFor('toggle-focus-mode'),
        run: () => useLayoutStore.getState().toggleFocusMode(),
      },
      {
        id: 'toggle-left-sidebar',
        label: 'Toggle left sidebar',
        shortcut: chordFor('toggle-left-sidebar'),
        run: () => useLayoutStore.getState().toggleLeftSidebarCollapsed(),
      },
      {
        id: 'toggle-ai-sidebar',
        label: 'Toggle AI sidebar',
        shortcut: chordFor('toggle-ai-sidebar'),
        run: () => useAiStore.getState().toggleRightSidebar(),
      },
      {
        id: 'open-settings',
        label: 'Open settings',
        run: () => useSettingsStore.getState().openSettings(),
      },
      {
        id: 'show-shortcuts',
        label: 'Show keyboard shortcuts',
        shortcut: chordFor('show-shortcuts'),
        run: () => useShortcutsStore.getState().openShortcuts(),
      },
      {
        id: 'toggle-theme',
        label: resolveColorMode(colorMode) === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
        run: () => setColorMode(resolveColorMode(colorMode) === 'dark' ? 'light' : 'dark'),
      },
    ];

    if (hasMultipleTabs) {
      items.push(
        {
          id: 'next-tab',
          label: 'Next tab',
          shortcut: chordFor('next-tab'),
          run: () => {
            const ws = useWorkspaceStore.getState();
            const idx = ws.tabs.findIndex((tab) => tab.id === ws.activeTabId);
            const next = ws.tabs[(idx + 1) % ws.tabs.length];
            if (next) ws.selectTab(next.id);
          },
        },
        {
          id: 'prev-tab',
          label: 'Previous tab',
          shortcut: chordFor('prev-tab'),
          run: () => {
            const ws = useWorkspaceStore.getState();
            const idx = ws.tabs.findIndex((tab) => tab.id === ws.activeTabId);
            const prev = ws.tabs[(idx - 1 + ws.tabs.length) % ws.tabs.length];
            if (prev) ws.selectTab(prev.id);
          },
        },
      );
    }

    const isDataTab = activeTab?.kind === 'table' || (activeTab?.kind === 'query' && !!activeTab.result);
    if (isDataTab) {
      items.push(
        {
          id: 'refresh-view',
          label: 'Refresh current view',
          shortcut: chordFor('refresh-view'),
          run: () => useWorkspaceStore.getState().requestViewAction('refresh'),
        },
        {
          id: 'export-current-table',
          label: 'Export current results',
          run: () => useWorkspaceStore.getState().requestViewAction('export'),
        },
      );
    }

    if (activeConnectionId && activeTab?.kind === 'table' && activeTab.schema) {
      const schema = activeTab.schema;
      items.push({
        id: 'open-er-diagram',
        label: `Open ER diagram for ${schema}`,
        run: () => useWorkspaceStore.getState().openErDiagram(activeConnectionId, schema),
      });
    }

    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keybindings, colorMode, setColorMode, activeConnectionId, activeTab, hasMultipleTabs]);
}
