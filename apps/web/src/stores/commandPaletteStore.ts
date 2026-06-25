import { create } from 'zustand';

/** Ephemeral UI state for the ⌘K command palette — intentionally not persisted (closes on reload). */
interface CommandPaletteState {
  open: boolean;
  openPalette: () => void;
  closePalette: () => void;
  toggle: () => void;
}

export const useCommandPaletteStore = create<CommandPaletteState>((set) => ({
  open: false,
  openPalette: () => set({ open: true }),
  closePalette: () => set({ open: false }),
  toggle: () => set((state) => ({ open: !state.open })),
}));
