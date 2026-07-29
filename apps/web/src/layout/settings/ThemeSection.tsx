import { useEffect, useState } from 'react';
import {
  DATA_COLOR_KEYS,
  HEX_COLOR_PATTERN,
  type ColorMode,
  type DataColorKey,
} from '@prost/shared-types';
import { Switch } from '@prost/ui';
import { useActiveConnection } from '../../api/connections';
import { useThemeStore } from '../../stores/themeStore';
import { ColorField } from '../ColorField';
import { PaletteSettings } from '../PaletteSettings';
import { SegmentedGroup } from '../SegmentedGroup';
import { match, type SectionProps } from './controls';

const colorModes: ColorMode[] = ['light', 'dark', 'system'];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const dataColorLabels: Record<DataColorKey, string> = {
  number: 'Number',
  string: 'String',
  decimal: 'Decimal',
  boolean: 'Boolean',
  temporal: 'Temporal',
  null: 'Null',
};

export function ThemeSection({ save, query }: SectionProps) {
  const colorMode = useThemeStore((s) => s.colorMode);
  const dataColors = useThemeStore((s) => s.dataColors);
  const accentColor = useThemeStore((s) => s.accentColor);
  const connectionOverrides = useThemeStore((s) => s.connectionOverrides);
  const setColorMode = useThemeStore((s) => s.setColorMode);
  const setDataColors = useThemeStore((s) => s.setDataColors);
  const setConnectionOverrides = useThemeStore((s) => s.setConnectionOverrides);

  const activeConnection = useActiveConnection();
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const [dataColorError, setDataColorError] = useState<string | null>(null);

  function handleColorMode(mode: ColorMode) {
    setColorMode(mode);
    save({ colorMode: mode });
  }

  function setOverrideColorMode(mode: ColorMode) {
    if (!activeConnection) return;
    const current = connectionOverrides[activeConnection.id] ?? {};
    const next = { ...connectionOverrides, [activeConnection.id]: { ...current, colorMode: mode } };
    setConnectionOverrides(next);
    save({ connectionOverrides: next });
  }

  function setDataColor(key: DataColorKey, hex: string) {
    if (hex && !HEX_COLOR_PATTERN.test(hex)) {
      setDataColorError(`"${hex}" is not a valid hex color.`);
      return;
    }
    setDataColorError(null);
    const next = { ...dataColors };
    if (hex) next[key] = hex;
    else delete next[key];
    setDataColors(next);
    save({ dataColors: next });
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

  const [overrideAccentDraft, setOverrideAccentDraft] = useState('');
  useEffect(() => {
    if (activeConnection && overrideOn) {
      setOverrideAccentDraft(connectionOverrides[activeConnection.id]?.accentColor ?? accentColor);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConnection?.id, overrideOn]);

  return (
    <div className="flex flex-col gap-lg">
      {match('Color mode', query) ? (
        <SegmentedGroup label="Color mode" options={colorModes} value={colorMode} render={cap} onSelect={handleColorMode} />
      ) : null}

      {match('Accent color palette', query) ? <PaletteSettings save={save} /> : null}

      {match('Data cell colors', query) ? (
        <div>
          <p className="mb-xs text-xs font-medium text-text-muted">Data-cell colors</p>
          <p className="mb-sm text-xs text-text-faint">Tints applied to grid values by type. Clear a field to restore the default.</p>
          <div className="flex flex-col gap-1">
            {DATA_COLOR_KEYS.map((key) => (
              <div key={key} className="flex items-center gap-sm">
                <span className="w-20 shrink-0 text-xs text-text-muted">{dataColorLabels[key]}</span>
                <ColorField
                  value={dataColors[key] ?? ''}
                  onChange={(v) => setDataColor(key, v.trim())}
                  onCommit={(v) => setDataColor(key, v.trim())}
                  ariaLabel={`${dataColorLabels[key]} data color`}
                  placeholder="#rrggbb"
                  className="min-w-0 flex-1"
                />
              </div>
            ))}
          </div>
          {dataColorError ? <p className="mt-xs text-xs text-danger">{dataColorError}</p> : null}
        </div>
      ) : null}

      {match('Per-connection theme accent', query) ? (
        <div>
          <p className="mb-xs text-xs font-medium text-text-muted">Per-connection theme</p>
          {activeConnection ? (
            <>
              <label className="flex items-center gap-sm text-xs text-text">
                <Switch checked={overrideOn} onChange={(e) => toggleOverride(e.target.checked)} />
                Use a distinct accent for &quot;{activeConnection.name}&quot;
              </label>
              {overrideOn ? (
                <>
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
                  <div className="mt-sm">
                    <SegmentedGroup
                      label="Override color mode"
                      options={colorModes}
                      value={connectionOverrides[activeConnection.id]?.colorMode ?? colorMode}
                      render={cap}
                      onSelect={setOverrideColorMode}
                    />
                  </div>
                </>
              ) : null}
              {overrideError ? <p className="mt-xs text-xs text-danger">{overrideError}</p> : null}
            </>
          ) : (
            <p className="text-xs italic text-text-faint">Select a connection to set a per-connection theme.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
