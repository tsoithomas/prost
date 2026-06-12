import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ColorMode } from '@prost/shared-types';
import { applyAccentColor, applyColorMode, contrastingTextColor, defaultAccentPreset } from '@prost/ui';

interface ThemeState {
  colorMode: ColorMode;
  accentColor: string;
  accentFg: string;
  setColorMode: (mode: ColorMode) => void;
  setAccentColor: (color: string, fg?: string) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      colorMode: 'system',
      accentColor: defaultAccentPreset.value,
      accentFg: defaultAccentPreset.fg,

      setColorMode: (mode) => {
        applyColorMode(mode);
        set({ colorMode: mode });
      },

      setAccentColor: (color, fg) => {
        const resolvedFg = fg ?? contrastingTextColor(color);
        applyAccentColor(color, resolvedFg);
        set({ accentColor: color, accentFg: resolvedFg });
      },
    }),
    {
      name: 'prost-theme',
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        applyColorMode(state.colorMode);
        applyAccentColor(state.accentColor, state.accentFg);
      },
    },
  ),
);
