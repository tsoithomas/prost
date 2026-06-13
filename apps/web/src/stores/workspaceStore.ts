import { create } from 'zustand';

export interface WorkspaceTab {
  id: string;
  label: string;
  kind: 'table' | 'query';
  schema?: string;
  table?: string;
  viewMode?: 'rows' | 'structure';
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
  loadQuery: (sql: string) => void;
  clearPendingQuerySql: () => void;
  setCursorPosition: (position: CursorPosition) => void;
}

const initialTabs: WorkspaceTab[] = [{ id: 'query-1', label: 'Query 1', kind: 'query' }];

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

  loadQuery: (sql) =>
    set((state) => {
      const queryTab = state.tabs.find((tab) => tab.kind === 'query');
      return { pendingQuerySql: sql, activeTabId: queryTab?.id ?? state.activeTabId };
    }),

  clearPendingQuerySql: () => set({ pendingQuerySql: null }),

  setCursorPosition: (position) => set({ cursorPosition: position }),
}));
