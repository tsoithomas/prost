import clsx from 'clsx';
import type { ColorMode } from '@prost/shared-types';
import { accentPresets, type AccentPreset } from '@prost/ui';
import { useUpdatePreferences } from '../api/preferences';
import { useThemeStore } from '../stores/themeStore';

const colorModes: ColorMode[] = ['light', 'dark', 'system'];

export function ThemeSettings() {
  const { colorMode, accentColor, setColorMode, setAccentColor } = useThemeStore();
  const updatePreferences = useUpdatePreferences();

  function handleColorMode(mode: ColorMode) {
    setColorMode(mode);
    updatePreferences.mutate({ colorMode: mode });
  }

  function handleAccentColor(preset: AccentPreset) {
    setAccentColor(preset.value, preset.fg);
    updatePreferences.mutate({ accentColor: preset.value });
  }

  return (
    <div className="flex flex-col gap-md">
      <div>
        <p className="mb-xs text-xs font-medium text-text-muted">Color mode</p>
        <div className="flex gap-1">
          {colorModes.map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => handleColorMode(mode)}
              className={clsx(
                'flex-1 rounded-sm px-sm py-1 text-xs capitalize transition-colors',
                colorMode === mode
                  ? 'bg-accent-muted text-accent'
                  : 'text-text-muted hover:bg-surface-hover hover:text-text',
              )}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-xs text-xs font-medium text-text-muted">Accent color</p>
        <div className="flex gap-2">
          {accentPresets.map((preset) => (
            <button
              key={preset.name}
              type="button"
              aria-label={preset.name}
              title={preset.name}
              onClick={() => handleAccentColor(preset)}
              className={clsx(
                'h-6 w-6 rounded-full border-2 transition-colors',
                accentColor === preset.value ? 'border-accent' : 'border-transparent',
              )}
              style={{ backgroundColor: preset.value }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
