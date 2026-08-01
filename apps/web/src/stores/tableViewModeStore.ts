import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type TableViewMode = 'rows' | 'structure' | 'profile';

/**
 * Remembers the last view mode (rows/structure/profile) a user left each table in (Phase 40), keyed
 * `connectionId → "schema.table"`, so reopening a table tab picks up where they left off. Purely a
 * frontend convenience — never touches the target DB, mirroring `pinnedTablesStore`'s shape.
 */
interface TableViewModeState {
  modes: Record<string, Record<string, TableViewMode>>;
  get: (connectionId: string, key: string) => TableViewMode | undefined;
  set: (connectionId: string, key: string, mode: TableViewMode) => void;
}

export const useTableViewModeStore = create<TableViewModeState>()(
  persist(
    (set, get) => ({
      modes: {},
      get: (connectionId, key) => get().modes[connectionId]?.[key],
      set: (connectionId, key, mode) =>
        set((state) => ({
          modes: {
            ...state.modes,
            [connectionId]: { ...state.modes[connectionId], [key]: mode },
          },
        })),
    }),
    { name: 'prost-table-view-mode' },
  ),
);
