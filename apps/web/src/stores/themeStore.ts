import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  ColorMode,
  ColumnRenderMode,
  ColumnRenderOverrides,
  ConnectionThemeOverride,
  CustomPalette,
  FontSize,
  GridDensity,
  KeybindingMap,
} from '@prost/shared-types';
import {
  applyAccentColor,
  applyColorMode,
  applyCustomPalette,
  applyFontSize,
  applyGridDensity,
  contrastingTextColor,
  defaultAccentPreset,
} from '@prost/ui';

interface ThemeState {
  colorMode: ColorMode;
  accentColor: string;
  accentFg: string;
  fontSize: FontSize;
  gridDensity: GridDensity;
  /** Saved palette library (server-backed). */
  customPalettes: CustomPalette[];
  /** Name of the palette currently applied on top of the base theme, or null for none. */
  activePaletteName: string | null;
  /** Keybinding overrides (merged over defaults by the keybindings util). */
  keybindings: KeybindingMap;
  /** Per-connection theme overrides, keyed by connectionId (server-backed). */
  connectionOverrides: Record<string, ConnectionThemeOverride>;
  /** Connection whose override is currently applied, for revert-on-switch. */
  activeOverrideConnectionId: string | null;
  /** Per-column "render as" overrides, keyed connectionId → "schema.table" → column (server-backed). */
  columnRenderOverrides: ColumnRenderOverrides;

  setColorMode: (mode: ColorMode) => void;
  setAccentColor: (color: string, fg?: string) => void;
  setFontSize: (size: FontSize) => void;
  setGridDensity: (density: GridDensity) => void;
  setCustomPalettes: (palettes: CustomPalette[]) => void;
  applyPalette: (name: string | null) => void;
  setKeybindings: (keybindings: KeybindingMap) => void;
  setConnectionOverrides: (overrides: Record<string, ConnectionThemeOverride>) => void;
  /** Re-themes for the active connection: applies its override, or reverts to the global theme. */
  applyConnectionTheme: (connectionId: string | null) => void;
  /** Replace the whole render-override map (used by server hydration). */
  setColumnRenderOverrides: (overrides: ColumnRenderOverrides) => void;
  /** Set (or clear, when `mode` is null) one column's render override; returns the new full map. */
  setColumnRenderOverride: (
    connectionId: string,
    sourceTable: string,
    column: string,
    mode: ColumnRenderMode | null,
  ) => ColumnRenderOverrides;
}

/** Immutably set/clear one leaf in the `connection → table → column → mode` map, pruning empties. */
function applyRenderOverride(
  current: ColumnRenderOverrides,
  connectionId: string,
  sourceTable: string,
  column: string,
  mode: ColumnRenderMode | null,
): ColumnRenderOverrides {
  const next: ColumnRenderOverrides = structuredClone(current);
  const tables = (next[connectionId] ??= {});
  const columns = (tables[sourceTable] ??= {});
  if (mode) {
    columns[column] = mode;
  } else {
    delete columns[column];
    if (Object.keys(columns).length === 0) delete tables[sourceTable];
    if (Object.keys(tables).length === 0) delete next[connectionId];
  }
  return next;
}

/** Applies the user's base (global) theme: color mode, accent, and any active custom palette. */
function applyBaseTheme(state: Pick<ThemeState, 'colorMode' | 'accentColor' | 'accentFg' | 'customPalettes' | 'activePaletteName'>) {
  applyColorMode(state.colorMode);
  const active = state.activePaletteName
    ? state.customPalettes.find((p) => p.name === state.activePaletteName)
    : undefined;
  // Palette first (it sets/clears the --color-* overrides, including accent); then re-assert the
  // global accent unless the active palette explicitly defines one — otherwise clearing the
  // palette's accent key would also wipe the global accent (both live on the same inline var).
  applyCustomPalette(active);
  if (!active?.colors.accent) {
    applyAccentColor(state.accentColor, state.accentFg);
  }
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      colorMode: 'system',
      accentColor: defaultAccentPreset.value,
      accentFg: defaultAccentPreset.fg,
      fontSize: 'md',
      gridDensity: 'normal',
      customPalettes: [],
      activePaletteName: null,
      keybindings: {},
      connectionOverrides: {},
      activeOverrideConnectionId: null,
      columnRenderOverrides: {},

      setColorMode: (mode) => {
        set({ colorMode: mode });
        // Color mode isn't part of a per-connection override (those carry only an accent), so it
        // must apply even when one is active — re-resolve so the override's accent is preserved.
        const overrideId = get().activeOverrideConnectionId;
        if (overrideId) get().applyConnectionTheme(overrideId);
        else applyColorMode(mode);
      },

      setAccentColor: (color, fg) => {
        const resolvedFg = fg ?? contrastingTextColor(color);
        set({ accentColor: color, accentFg: resolvedFg });
        if (!get().activeOverrideConnectionId) applyAccentColor(color, resolvedFg);
      },

      setFontSize: (size) => {
        applyFontSize(size);
        set({ fontSize: size });
      },

      setGridDensity: (density) => {
        applyGridDensity(density);
        set({ gridDensity: density });
      },

      setCustomPalettes: (palettes) => {
        set({ customPalettes: palettes });
        // Drop the active selection if its palette was deleted.
        const { activePaletteName } = get();
        if (activePaletteName && !palettes.some((p) => p.name === activePaletteName)) {
          set({ activePaletteName: null });
        }
        if (!get().activeOverrideConnectionId) applyBaseTheme(get());
      },

      applyPalette: (name) => {
        set({ activePaletteName: name });
        if (!get().activeOverrideConnectionId) applyBaseTheme(get());
      },

      setKeybindings: (keybindings) => set({ keybindings }),

      // Re-resolution against the active connection is driven by an effect in AppLayout that
      // watches both this map and the active connection id.
      setConnectionOverrides: (overrides) => set({ connectionOverrides: overrides }),

      applyConnectionTheme: (connectionId) => {
        const state = get();
        const override = connectionId ? state.connectionOverrides[connectionId] : undefined;
        if (override) {
          applyColorMode(override.colorMode ?? state.colorMode);
          if (override.accentColor) {
            applyAccentColor(override.accentColor, contrastingTextColor(override.accentColor));
          } else {
            applyAccentColor(state.accentColor, state.accentFg);
          }
          set({ activeOverrideConnectionId: connectionId });
        } else {
          applyBaseTheme(state);
          set({ activeOverrideConnectionId: null });
        }
      },

      setColumnRenderOverrides: (overrides) => set({ columnRenderOverrides: overrides }),

      setColumnRenderOverride: (connectionId, sourceTable, column, mode) => {
        const next = applyRenderOverride(get().columnRenderOverrides, connectionId, sourceTable, column, mode);
        set({ columnRenderOverrides: next });
        return next;
      },
    }),
    {
      name: 'prost-theme',
      // Persist user prefs only; `activeOverrideConnectionId` is transient (AppLayout re-resolves it).
      partialize: (state) => ({
        colorMode: state.colorMode,
        accentColor: state.accentColor,
        accentFg: state.accentFg,
        fontSize: state.fontSize,
        gridDensity: state.gridDensity,
        customPalettes: state.customPalettes,
        activePaletteName: state.activePaletteName,
        keybindings: state.keybindings,
        connectionOverrides: state.connectionOverrides,
        columnRenderOverrides: state.columnRenderOverrides,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        applyBaseTheme(state);
        applyFontSize(state.fontSize);
        applyGridDensity(state.gridDensity);
      },
    },
  ),
);
