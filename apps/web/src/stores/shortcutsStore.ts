import { create } from 'zustand';

/** Ephemeral open/close state for the keyboard-shortcuts help overlay — not persisted. */
interface ShortcutsState {
  open: boolean;
  openShortcuts: () => void;
  closeShortcuts: () => void;
  toggleShortcuts: () => void;
}

export const useShortcutsStore = create<ShortcutsState>((set) => ({
  open: false,
  openShortcuts: () => set({ open: true }),
  closeShortcuts: () => set({ open: false }),
  toggleShortcuts: () => set((s) => ({ open: !s.open })),
}));
