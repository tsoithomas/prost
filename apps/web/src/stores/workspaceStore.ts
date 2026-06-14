import { create } from 'zustand';
import type { QueryResult } from '@prost/shared-types';

export interface WorkspaceTab {
  id: string;
  label: string;
  kind: 'table' | 'query';
  schema?: string;
  table?: string;
  viewMode?: 'rows' | 'structure';
  sql?: string;
  result?: QueryResult | null;
}

export interface CursorPosition {
  line: number;
  column: number;
}

interface WorkspaceState {
  tabs: WorkspaceTab[];
  activeTabId: string;
  pendingQuerySql: string | null;
  cursorPosition: CursorPosition | null;
  openTable: (schema: string, table: string, viewMode?: 'rows' | 'structure') => void;
  setTabViewMode: (id: string, viewMode: 'rows' | 'structure') => void;
  selectTab: (id: string) => void;
  closeTab: (id: string) => void;
  newQueryTab: () => void;
  setTabSql: (id: string, sql: string) => void;
  setTabResult: (id: string, result: QueryResult | null) => void;
  loadQuery: (sql: string) => void;
  clearPendingQuerySql: () => void;
  setCursorPosition: (position: CursorPosition) => void;
}

export const INITIAL_SQL = '-- Press Cmd/Ctrl+Enter to run\nSELECT * FROM users;';

const initialTabs: WorkspaceTab[] = [
  { id: 'query-1', label: 'Query 1', kind: 'query', sql: INITIAL_SQL, result: null },
];

export const useWorkspaceStore = create<WorkspaceState>()((set) => ({
  tabs: initialTabs,
  activeTabId: initialTabs[0]!.id,
  pendingQuerySql: null,
  cursorPosition: null,

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

  loadQuery: (sql) =>
    set((state) => {
      const active = state.tabs.find((tab) => tab.id === state.activeTabId);
      const target = active?.kind === 'query' ? active : state.tabs.find((tab) => tab.kind === 'query');
      return { pendingQuerySql: sql, activeTabId: target?.id ?? state.activeTabId };
    }),

  clearPendingQuerySql: () => set({ pendingQuerySql: null }),

  setCursorPosition: (position) => set({ cursorPosition: position }),
}));
