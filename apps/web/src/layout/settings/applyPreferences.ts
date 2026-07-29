import type { UserPreferenceDto } from '@prost/shared-types';
import { useThemeStore } from '../../stores/themeStore';

/** Applies a (partial) preference set to `themeStore`, calling each setter so the UI updates live. */
export function applyPreferencesToStore(prefs: Partial<UserPreferenceDto>): void {
  const s = useThemeStore.getState();
  if (prefs.colorMode !== undefined) s.setColorMode(prefs.colorMode);
  if (prefs.accentColor !== undefined) s.setAccentColor(prefs.accentColor);
  if (prefs.fontSize !== undefined) s.setFontSize(prefs.fontSize);
  if (prefs.gridDensity !== undefined) s.setGridDensity(prefs.gridDensity);
  if (prefs.customPalettes !== undefined) s.setCustomPalettes(prefs.customPalettes);
  if (prefs.keybindings !== undefined) s.setKeybindings(prefs.keybindings);
  if (prefs.connectionOverrides !== undefined) s.setConnectionOverrides(prefs.connectionOverrides);
  if (prefs.columnRenderOverrides !== undefined) s.setColumnRenderOverrides(prefs.columnRenderOverrides);
  if (prefs.fontFamily !== undefined) s.setFontFamily(prefs.fontFamily);
  if (prefs.monoFontFamily !== undefined) s.setMonoFontFamily(prefs.monoFontFamily);
  if (prefs.radiusScale !== undefined) s.setRadiusScale(prefs.radiusScale);
  if (prefs.dataColors !== undefined) s.setDataColors(prefs.dataColors);
}

/** Snapshots the current `themeStore` state as a `UserPreferenceDto` (for export). */
export function currentPreferencesFromStore(): UserPreferenceDto {
  const s = useThemeStore.getState();
  return {
    colorMode: s.colorMode,
    accentColor: s.accentColor,
    fontSize: s.fontSize,
    gridDensity: s.gridDensity,
    keybindings: s.keybindings,
    customPalettes: s.customPalettes,
    connectionOverrides: s.connectionOverrides,
    columnRenderOverrides: s.columnRenderOverrides,
    fontFamily: s.fontFamily,
    monoFontFamily: s.monoFontFamily,
    radiusScale: s.radiusScale,
    dataColors: s.dataColors,
  };
}

/**
 * The shipped styling defaults, used by "Reset appearance". Deliberately excludes per-connection theme
 * overrides, column render overrides, and keybindings so a reset doesn't wipe unrelated user config.
 */
export const DEFAULT_STYLE_PREFERENCES: Partial<UserPreferenceDto> = {
  colorMode: 'system',
  accentColor: '#498fff',
  fontSize: 'md',
  gridDensity: 'normal',
  fontFamily: 'inter',
  monoFontFamily: 'jetbrains-mono',
  radiusScale: 'normal',
  customPalettes: [],
  dataColors: {},
};
