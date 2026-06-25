import { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import {
  FONT_SIZES,
  GRID_DENSITIES,
  HEX_COLOR_PATTERN,
  type ColorMode,
  type FontSize,
  type GridDensity,
  type UserPreferenceDto,
} from '@prost/shared-types';
import { Checkbox, Toast } from '@prost/ui';
import { useActiveConnection } from '../api/connections';
import { useUpdatePreferences } from '../api/preferences';
import { useThemeStore } from '../stores/themeStore';
import { ColorField } from './ColorField';
import { KeybindingSettings } from './KeybindingSettings';
import { PaletteSettings } from './PaletteSettings';

const colorModes: ColorMode[] = ['light', 'dark', 'system'];
const fontSizeLabels: Record<FontSize, string> = { sm: 'Small', md: 'Medium', lg: 'Large' };
const densityLabels: Record<GridDensity, string> = {
  compact: 'Compact',
  normal: 'Normal',
  comfortable: 'Comfortable',
};

function SegmentedGroup<T extends string>({
  label,
  options,
  value,
  render,
  onSelect,
}: {
  label: string;
  options: readonly T[];
  value: T;
  render: (option: T) => string;
  onSelect: (option: T) => void;
}) {
  return (
    <div>
      <p className="mb-xs text-xs font-medium text-text-muted">{label}</p>
      <div className="flex gap-1">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onSelect(option)}
            className={clsx(
              'flex-1 rounded-sm px-sm py-1 text-xs transition-colors',
              value === option
                ? 'bg-accent-muted text-accent'
                : 'text-text-muted hover:bg-surface-hover hover:text-text',
            )}
          >
            {render(option)}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ThemeSettings() {
  const colorMode = useThemeStore((s) => s.colorMode);
  const fontSize = useThemeStore((s) => s.fontSize);
  const gridDensity = useThemeStore((s) => s.gridDensity);
  const accentColor = useThemeStore((s) => s.accentColor);
  const keybindings = useThemeStore((s) => s.keybindings);
  const connectionOverrides = useThemeStore((s) => s.connectionOverrides);
  const setColorMode = useThemeStore((s) => s.setColorMode);
  const setFontSize = useThemeStore((s) => s.setFontSize);
  const setGridDensity = useThemeStore((s) => s.setGridDensity);
  const setKeybindings = useThemeStore((s) => s.setKeybindings);
  const setConnectionOverrides = useThemeStore((s) => s.setConnectionOverrides);

  const updatePreferences = useUpdatePreferences();
  const [error, setError] = useState<string | null>(null);
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const activeConnection = useActiveConnection();

  const save = useCallback(
    (dto: Partial<UserPreferenceDto>) => {
      updatePreferences.mutate(dto, {
        onError: () => setError('Failed to save preferences — your change may not persist.'),
        onSuccess: () => setError(null),
      });
    },
    [updatePreferences],
  );

  function handleColorMode(mode: ColorMode) {
    setColorMode(mode);
    save({ colorMode: mode });
  }

  function handleFontSize(size: FontSize) {
    setFontSize(size);
    save({ fontSize: size });
  }

  function handleGridDensity(density: GridDensity) {
    setGridDensity(density);
    save({ gridDensity: density });
  }

  function handleKeybindings(next: Record<string, string>) {
    setKeybindings(next);
    save({ keybindings: next });
  }

  const overrideOn = activeConnection ? Boolean(connectionOverrides[activeConnection.id]) : false;

  function toggleOverride(checked: boolean) {
    if (!activeConnection) return;
    setOverrideError(null);
    const next = { ...connectionOverrides };
    if (checked) next[activeConnection.id] = { accentColor };
    else delete next[activeConnection.id];
    setConnectionOverrides(next);
    save({ connectionOverrides: next });
  }

  function setOverrideAccent(hex: string) {
    if (!activeConnection) return;
    if (!HEX_COLOR_PATTERN.test(hex)) {
      setOverrideError(`"${hex}" is not a valid hex color.`);
      return;
    }
    setOverrideError(null);
    const next = { ...connectionOverrides, [activeConnection.id]: { accentColor: hex } };
    setConnectionOverrides(next);
    save({ connectionOverrides: next });
  }

  // Seed the override-accent draft from the stored value when the connection or toggle changes
  // (not on every keystroke, so it doesn't clobber in-progress edits).
  const [overrideAccentDraft, setOverrideAccentDraft] = useState('');
  useEffect(() => {
    if (activeConnection && overrideOn) {
      setOverrideAccentDraft(connectionOverrides[activeConnection.id]?.accentColor ?? accentColor);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConnection?.id, overrideOn]);

  return (
    <div className="flex flex-col gap-md">
      {error ? <Toast variant="danger" message={error} onDismiss={() => setError(null)} /> : null}

      <SegmentedGroup
        label="Color mode"
        options={colorModes}
        value={colorMode}
        render={(m) => m.charAt(0).toUpperCase() + m.slice(1)}
        onSelect={handleColorMode}
      />
      <SegmentedGroup
        label="Font size"
        options={FONT_SIZES}
        value={fontSize}
        render={(s) => fontSizeLabels[s]}
        onSelect={handleFontSize}
      />
      <SegmentedGroup
        label="Grid density"
        options={GRID_DENSITIES}
        value={gridDensity}
        render={(d) => densityLabels[d]}
        onSelect={handleGridDensity}
      />

      <PaletteSettings save={save} />

      <div>
        <p className="mb-xs text-xs font-medium text-text-muted">Per-connection theme</p>
        {activeConnection ? (
          <>
            <label className="flex items-center gap-sm text-xs text-text">
              <Checkbox checked={overrideOn} onChange={(e) => toggleOverride(e.target.checked)} />
              Use a distinct accent for &quot;{activeConnection.name}&quot;
            </label>
            {overrideOn ? (
              <div className="mt-sm flex items-center gap-sm">
                <span className="text-xs text-text-muted">Override accent</span>
                <ColorField
                  value={overrideAccentDraft}
                  onChange={setOverrideAccentDraft}
                  onCommit={setOverrideAccent}
                  ariaLabel="Override accent hex"
                  className="min-w-0 flex-1"
                />
              </div>
            ) : null}
            {overrideError ? <p className="mt-xs text-xs text-danger">{overrideError}</p> : null}
          </>
        ) : (
          <p className="text-xs italic text-text-faint">Select a connection to set a per-connection theme.</p>
        )}
      </div>

      <KeybindingSettings keybindings={keybindings} onChange={handleKeybindings} />
    </div>
  );
}
