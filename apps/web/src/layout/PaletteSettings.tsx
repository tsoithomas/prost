import { useState } from 'react';
import clsx from 'clsx';
import { Trash2 } from 'lucide-react';
import {
  HEX_COLOR_PATTERN,
  MAX_PALETTES,
  PALETTE_TOKEN_KEYS,
  type CustomPalette,
  type PaletteTokenKey,
  type UserPreferenceDto,
} from '@prost/shared-types';
import { accentPresets, Button, contrastingTextColor, Input, type AccentPreset } from '@prost/ui';
import { useThemeStore } from '../stores/themeStore';
import { ColorField } from './ColorField';

export interface PaletteSettingsProps {
  save: (dto: Partial<UserPreferenceDto>) => void;
}

const emptyDraft = (): Record<PaletteTokenKey, string> =>
  Object.fromEntries(PALETTE_TOKEN_KEYS.map((k) => [k, ''])) as Record<PaletteTokenKey, string>;

export function PaletteSettings({ save }: PaletteSettingsProps) {
  const accentColor = useThemeStore((s) => s.accentColor);
  const setAccentColor = useThemeStore((s) => s.setAccentColor);
  const customPalettes = useThemeStore((s) => s.customPalettes);
  const activePaletteName = useThemeStore((s) => s.activePaletteName);
  const applyPalette = useThemeStore((s) => s.applyPalette);
  const setCustomPalettes = useThemeStore((s) => s.setCustomPalettes);

  const [hexDraft, setHexDraft] = useState('');
  const [name, setName] = useState('');
  const [colors, setColors] = useState<Record<PaletteTokenKey, string>>(emptyDraft);
  const [error, setError] = useState<string | null>(null);

  function selectPreset(preset: AccentPreset) {
    applyPalette(null);
    setAccentColor(preset.value, preset.fg);
    save({ accentColor: preset.value });
  }

  function applyCustomHex(hex: string = hexDraft) {
    if (!HEX_COLOR_PATTERN.test(hex)) {
      setError(`"${hex}" is not a valid hex color.`);
      return;
    }
    setError(null);
    applyPalette(null);
    setAccentColor(hex);
    save({ accentColor: hex });
    // Keep the applied value in the field (don't clear) so the swatch + hex stay visible.
    setHexDraft(hex);
  }

  function addPalette() {
    if (!name.trim()) {
      setError('Palette name is required.');
      return;
    }
    if (customPalettes.some((p) => p.name === name.trim())) {
      setError(`A palette named "${name.trim()}" already exists.`);
      return;
    }
    const picked: Partial<Record<PaletteTokenKey, string>> = {};
    for (const key of PALETTE_TOKEN_KEYS) {
      const value = colors[key].trim();
      if (!value) continue;
      if (!HEX_COLOR_PATTERN.test(value)) {
        setError(`"${value}" is not a valid hex color.`);
        return;
      }
      picked[key] = value;
    }
    setError(null);
    const paletteName = name.trim();
    const next: CustomPalette[] = [...customPalettes, { name: paletteName, colors: picked }];
    setCustomPalettes(next);
    save({ customPalettes: next });
    // Apply it immediately so the new palette is previewed in the UI right after adding.
    applyPalette(paletteName);
    setName('');
    setColors(emptyDraft());
  }

  function deletePalette(target: string) {
    const next = customPalettes.filter((p) => p.name !== target);
    setCustomPalettes(next);
    save({ customPalettes: next });
  }

  return (
    <div>
      <p className="mb-xs text-xs font-medium text-text-muted">Accent color</p>
      <div className="flex flex-wrap items-center gap-2">
        {accentPresets.map((preset) => (
          <button
            key={preset.name}
            type="button"
            aria-label={preset.name}
            title={preset.name}
            onClick={() => selectPreset(preset)}
            className={clsx(
              'h-6 w-6 rounded-full border-2 transition-colors',
              !activePaletteName && accentColor === preset.value ? 'border-accent' : 'border-transparent',
            )}
            style={{ backgroundColor: preset.value }}
          />
        ))}
      </div>

      <div className="mt-sm flex items-center gap-sm">
        <ColorField
          value={hexDraft}
          onChange={setHexDraft}
          onCommit={(v) => {
            setHexDraft(v);
            applyCustomHex(v);
          }}
          placeholder="#1f6feb"
          ariaLabel="Custom accent hex"
          className="min-w-0 flex-1"
        />
        <Button variant="secondary" size="sm" onClick={() => applyCustomHex()} disabled={!hexDraft.trim()}>
          Apply
        </Button>
      </div>

      <p className="mb-xs mt-md text-xs font-medium text-text-muted">Custom palettes</p>
      {customPalettes.length > 0 ? (
        <div className="mb-sm flex flex-col gap-1">
          {customPalettes.map((palette) => (
            <div key={palette.name} className="flex items-center gap-sm">
              <button
                type="button"
                onClick={() => applyPalette(activePaletteName === palette.name ? null : palette.name)}
                className={clsx(
                  'flex flex-1 items-center gap-sm rounded-sm px-sm py-1 text-left text-xs transition-colors',
                  activePaletteName === palette.name
                    ? 'bg-accent-muted text-accent'
                    : 'text-text-muted hover:bg-surface-hover hover:text-text',
                )}
              >
                <span className="flex gap-1">
                  {PALETTE_TOKEN_KEYS.filter((k) => palette.colors[k]).map((k) => (
                    <span
                      key={k}
                      className="h-3 w-3 rounded-full border border-border"
                      style={{ backgroundColor: palette.colors[k], color: contrastingTextColor(palette.colors[k]!) }}
                    />
                  ))}
                </span>
                <span className="truncate">{palette.name}</span>
              </button>
              <button
                type="button"
                aria-label={`Delete ${palette.name}`}
                onClick={() => deletePalette(palette.name)}
                className="shrink-0 text-text-faint hover:text-danger"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {customPalettes.length < MAX_PALETTES ? (
        <div className="flex flex-col gap-1 rounded-md border border-border p-sm">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Palette name"
            aria-label="New palette name"
            className="text-xs"
          />
          {PALETTE_TOKEN_KEYS.map((key) => (
            <div key={key} className="flex items-center gap-sm">
              <span className="w-16 text-xs capitalize text-text-muted">{key}</span>
              <ColorField
                value={colors[key]}
                onChange={(v) => setColors((prev) => ({ ...prev, [key]: v }))}
                placeholder="#rrggbb (optional)"
                ariaLabel={`${key} color`}
                className="min-w-0 flex-1"
              />
            </div>
          ))}
          {PALETTE_TOKEN_KEYS.some((k) => HEX_COLOR_PATTERN.test(colors[k].trim())) ? (
            <div className="mt-1 flex items-center gap-sm">
              <span className="w-16 text-xs text-text-muted">Preview</span>
              <div className="flex gap-1">
                {PALETTE_TOKEN_KEYS.filter((k) => HEX_COLOR_PATTERN.test(colors[k].trim())).map((k) => (
                  <span
                    key={k}
                    title={`${k}: ${colors[k].trim()}`}
                    className="h-4 w-4 rounded-full border border-border"
                    style={{ backgroundColor: colors[k].trim() }}
                  />
                ))}
              </div>
            </div>
          ) : null}
          <Button variant="secondary" size="sm" className="mt-1 self-start" onClick={addPalette}>
            Add palette
          </Button>
        </div>
      ) : (
        <p className="text-xs italic text-text-faint">Palette limit reached ({MAX_PALETTES}).</p>
      )}

      {error ? <p className="mt-xs text-xs text-danger">{error}</p> : null}
    </div>
  );
}
