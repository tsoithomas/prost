import { create } from 'zustand';
import type { ExecuteQueryResponse } from '@prost/shared-types';

export interface WorkspaceTab {
  id: string;
  label: string;
  kind: 'table' | 'query';
  schema?: string;
  table?: string;
  viewMode?: 'rows' | 'structure';
  sql?: string;
  result?: ExecuteQueryResponse | null;
  /** "Run as transaction" toggle, per tab. Default `false`. */
  transactional?: boolean;
}

export interface CursorPosition {
  line: number;
  column: number;
}

export interface RevealColumnTarget {
  schema: string;
  table: string;
  column: string;
}

interface WorkspaceState {
  tabs: WorkspaceTab[];
  activeTabId: string;
  pendingQuerySql: string | null;
  cursorPosition: CursorPosition | null;
  /** A column the structure panel should scroll to + highlight (set by global search). */
  revealColumn: RevealColumnTarget | null;
  openTable: (schema: string, table: string, viewMode?: 'rows' | 'structure') => void;
  revealTableColumn: (schema: string, table: string, column: string) => void;
  clearRevealColumn: () => void;
  setTabViewMode: (id: string, viewMode: 'rows' | 'structure') => void;
  selectTab: (id: string) => void;
  closeTab: (id: string) => void;
  closeOtherTabs: (id: string) => void;
  closeTabsToLeft: (id: string) => void;
  closeTabsToRight: (id: string) => void;
  closeAllTableTabs: () => void;
  reorderTab: (draggedId: string, targetId: string) => void;
  newQueryTab: () => void;
  setTabSql: (id: string, sql: string) => void;
  setTabResult: (id: string, result: ExecuteQueryResponse | null) => void;
  setTabTransactional: (id: string, transactional: boolean) => void;
  loadQuery: (sql: string) => void;
  clearPendingQuerySql: () => void;
  setCursorPosition: (position: CursorPosition) => void;
}

export const INITIAL_SQL =
  '-- Cmd/Ctrl+Enter: run statement at cursor · Cmd/Ctrl+Shift+Enter: run all\nSELECT * FROM users;';

const initialTabs: WorkspaceTab[] = [
  { id: 'query-1', label: 'Query 1', kind: 'query', sql: INITIAL_SQL, result: null },
];

/**
 * Closes every tab except those `keep` returns true for, while preserving the invariant that
 * at least one query tab always remains (if the kept set has none, the first query tab is
 * retained). Repoints `activeTabId` to a surviving tab when the active one was closed.
 */
function applyClose(
  tabs: WorkspaceTab[],
  activeTabId: string,
  keep: (tab: WorkspaceTab, index: number) => boolean,
): { tabs: WorkspaceTab[]; activeTabId: string } {
  let next = tabs.filter(keep);
  if (!next.some((tab) => tab.kind === 'query')) {
    const firstQuery = tabs.find((tab) => tab.kind === 'query');
    if (firstQuery) next = tabs.filter((tab, i) => keep(tab, i) || tab.id === firstQuery.id);
  }
  const nextActive = next.some((tab) => tab.id === activeTabId)
    ? activeTabId
    : next[next.length - 1]?.id ?? activeTabId;
  return { tabs: next, activeTabId: nextActive };
}

export const useWorkspaceStore = create<WorkspaceState>()((set) => ({
  tabs: initialTabs,
  activeTabId: initialTabs[0]!.id,
  pendingQuerySql: null,
  cursorPosition: null,
  revealColumn: null,

  openTable: (schema, table, viewMode = 'rows') => {
    const id = `table:${schema}.${table}`;
    set((state) => {
      if (state.tabs.some((tab) => tab.id === id)) {
        return {
          activeTabId: id,
          tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, viewMode } : tab)),
        };
      }
      return {
        tabs: [...state.tabs, { id, label: table, kind: 'table', schema, table, viewMode }],
        activeTabId: id,
      };
    });
  },

  revealTableColumn: (schema, table, column) => {
    const id = `table:${schema}.${table}`;
    set((state) => {
      const exists = state.tabs.some((tab) => tab.id === id);
      return {
        revealColumn: { schema, table, column },
        activeTabId: id,
        tabs: exists
          ? state.tabs.map((tab) => (tab.id === id ? { ...tab, viewMode: 'structure' } : tab))
          : [...state.tabs, { id, label: table, kind: 'table', schema, table, viewMode: 'structure' }],
      };
    });
  },

  clearRevealColumn: () => set({ revealColumn: null }),

  setTabViewMode: (id, viewMode) =>
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, viewMode } : tab)),
    })),

  selectTab: (id) => set({ activeTabId: id }),

  closeTab: (id) =>
    set((state) => {
      const tabs = state.tabs.filter((tab) => tab.id !== id);
      const activeTabId =
        id === state.activeTabId ? tabs[tabs.length - 1]?.id ?? tabs[0]?.id ?? id : state.activeTabId;
      return { tabs, activeTabId };
    }),

  closeOtherTabs: (id) =>
    set((state) => applyClose(state.tabs, state.activeTabId, (tab) => tab.id === id)),

  closeTabsToLeft: (id) =>
    set((state) => {
      const idx = state.tabs.findIndex((tab) => tab.id === id);
      if (idx === -1) return state;
      return applyClose(state.tabs, state.activeTabId, (_tab, i) => i >= idx);
    }),

  closeTabsToRight: (id) =>
    set((state) => {
      const idx = state.tabs.findIndex((tab) => tab.id === id);
      if (idx === -1) return state;
      return applyClose(state.tabs, state.activeTabId, (_tab, i) => i <= idx);
    }),

  closeAllTableTabs: () =>
    set((state) => applyClose(state.tabs, state.activeTabId, (tab) => tab.kind === 'query')),

  reorderTab: (draggedId, targetId) =>
    set((state) => {
      if (draggedId === targetId) return state;
      const from = state.tabs.findIndex((tab) => tab.id === draggedId);
      const to = state.tabs.findIndex((tab) => tab.id === targetId);
      if (from === -1 || to === -1) return state;
      const tabs = [...state.tabs];
      const [moved] = tabs.splice(from, 1);
      tabs.splice(to, 0, moved!);
      return { tabs };
    }),

  newQueryTab: () =>
    set((state) => {
      const queryTabCount = state.tabs.filter((tab) => tab.kind === 'query').length;
      const id = `query-${crypto.randomUUID()}`;
      const tab: WorkspaceTab = {
        id,
        label: `Query ${queryTabCount + 1}`,
        kind: 'query',
        sql: INITIAL_SQL,
        result: null,
      };
      return { tabs: [...state.tabs, tab], activeTabId: id };
    }),

  setTabSql: (id, sql) =>
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, sql } : tab)),
    })),

  setTabResult: (id, result) =>
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, result } : tab)),
    })),

  setTabTransactional: (id, transactional) =>
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, transactional } : tab)),
    })),

  loadQuery: (sql) =>
    set((state) => {
      const active = state.tabs.find((tab) => tab.id === state.activeTabId);
      const target = active?.kind === 'query' ? active : state.tabs.find((tab) => tab.kind === 'query');
      return { pendingQuerySql: sql, activeTabId: target?.id ?? state.activeTabId };
    }),

  clearPendingQuerySql: () => set({ pendingQuerySql: null }),

  setCursorPosition: (position) => set({ cursorPosition: position }),
}));
