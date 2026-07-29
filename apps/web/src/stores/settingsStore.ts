import { create } from 'zustand';

/** Ephemeral open/close state for the full Settings modal — not persisted (closes on reload). */
interface SettingsState {
  open: boolean;
  /** The section to open on; defaults to 'appearance'. */
  section: string;
  openSettings: (section?: string) => void;
  closeSettings: () => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  open: false,
  section: 'appearance',
  openSettings: (section = 'appearance') => set({ open: true, section }),
  closeSettings: () => set({ open: false }),
}));
