import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Per-connection set of "pinned" tables, surfaced at the top of the Explorer tab.
 * Keyed by `connectionId` → array of `schema.table` composite keys (insertion order
 * = display order). Purely a frontend convenience; never touches the target DB.
 */
interface PinnedTablesState {
  pinned: Record<string, string[]>;
  toggle: (connectionId: string, key: string) => void;
}

export const usePinnedTablesStore = create<PinnedTablesState>()(
  persist(
    (set) => ({
      pinned: {},
      toggle: (connectionId, key) =>
        set((state) => {
          const current = state.pinned[connectionId] ?? [];
          const next = current.includes(key)
            ? current.filter((k) => k !== key)
            : [...current, key];
          return { pinned: { ...state.pinned, [connectionId]: next } };
        }),
    }),
    { name: 'prost-pinned-tables' },
  ),
);
