import { create } from 'zustand';

export interface WorkspaceTab {
  id: string;
  label: string;
  kind: 'table' | 'query';
  schema?: string;
  table?: string;
}

interface WorkspaceState {
  tabs: WorkspaceTab[];
  activeTabId: string;
  pendingQuerySql: string | null;
  openTable: (schema: string, table: string) => void;
  selectTab: (id: string) => void;
  closeTab: (id: string) => void;
  loadQuery: (sql: string) => void;
  clearPendingQuerySql: () => void;
}

const initialTabs: WorkspaceTab[] = [{ id: 'query-1', label: 'Query 1', kind: 'query' }];

export const useWorkspaceStore = create<WorkspaceState>()((set) => ({
  tabs: initialTabs,
  activeTabId: initialTabs[0]!.id,
  pendingQuerySql: null,

  openTable: (schema, table) => {
    const id = `table:${schema}.${table}`;
    set((state) => {
      if (state.tabs.some((tab) => tab.id === id)) {
        return { activeTabId: id };
      }
      return {
        tabs: [...state.tabs, { id, label: table, kind: 'table', schema, table }],
        activeTabId: id,
      };
    });
  },

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
}));
