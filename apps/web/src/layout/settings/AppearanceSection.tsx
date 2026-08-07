import {
  FONT_FAMILIES,
  FONT_SIZES,
  RADIUS_SCALES,
  type FontFamily,
  type FontSize,
  type RadiusScale,
} from '@prost/shared-types';
import { useThemeStore } from '../../stores/themeStore';
import { SegmentedGroup } from '../SegmentedGroup';
import { match, SettingSwitch, type SectionProps } from './controls';

// Short labels: five segments have to share the row without wrapping.
const fontSizeLabels: Record<FontSize, string> = { xs: 'XS', sm: 'S', md: 'M', lg: 'L', xl: 'XL' };
const fontFamilyLabels: Record<FontFamily, string> = { system: 'System', inter: 'Inter', serif: 'Serif' };
const radiusLabels: Record<RadiusScale, string> = {
  square: 'Square',
  compact: 'Compact',
  normal: 'Normal',
  roomy: 'Roomy',
  round: 'Round',
};

export function AppearanceSection({ save, query }: SectionProps) {
  const fontSize = useThemeStore((s) => s.fontSize);
  const fontFamily = useThemeStore((s) => s.fontFamily);
  const radiusScale = useThemeStore((s) => s.radiusScale);
  const reduceMotion = useThemeStore((s) => s.reduceMotion);
  const hideFocusRing = useThemeStore((s) => s.hideFocusRing);
  const aiEnabled = useThemeStore((s) => s.aiEnabled);
  const setFontSize = useThemeStore((s) => s.setFontSize);
  const setFontFamily = useThemeStore((s) => s.setFontFamily);
  const setRadiusScale = useThemeStore((s) => s.setRadiusScale);
  const setReduceMotion = useThemeStore((s) => s.setReduceMotion);
  const setHideFocusRing = useThemeStore((s) => s.setHideFocusRing);
  const setAiEnabled = useThemeStore((s) => s.setAiEnabled);

  function handleFontSize(size: FontSize) {
    setFontSize(size);
    save({ fontSize: size });
  }
  function handleFontFamily(family: FontFamily) {
    setFontFamily(family);
    save({ fontFamily: family });
  }
  function handleRadius(scale: RadiusScale) {
    setRadiusScale(scale);
    save({ radiusScale: scale });
  }

  return (
    <div className="flex flex-col gap-lg">
      {match('Font size', query) ? (
        <SegmentedGroup
          label="Font size"
          options={FONT_SIZES}
          value={fontSize}
          render={(s) => fontSizeLabels[s]}
          onSelect={handleFontSize}
        />
      ) : null}
      {match('Font family', query) ? (
        <SegmentedGroup
          label="Font family"
          options={FONT_FAMILIES}
          value={fontFamily ?? 'inter'}
          render={(f) => fontFamilyLabels[f]}
          onSelect={handleFontFamily}
        />
      ) : null}
      {match('Corner radius', query) ? (
        <SegmentedGroup
          label="Corner radius"
          options={RADIUS_SCALES}
          value={radiusScale}
          render={(r) => radiusLabels[r]}
          onSelect={handleRadius}
        />
      ) : null}
      {match('Reduce motion animations', query) ? (
        <SettingSwitch
          label="Reduce motion"
          description="Minimize transitions and animations."
          checked={reduceMotion}
          onChange={(on) => {
            setReduceMotion(on);
            save({ reduceMotion: on });
          }}
        />
      ) : null}
      {match('Hide keyboard focus ring outline', query) ? (
        <SettingSwitch
          label="Hide focus ring"
          description="Hide the outline shown around the focused element when navigating with a keyboard. On by default — turn it off if you rely on seeing keyboard focus."
          checked={hideFocusRing}
          onChange={(on) => {
            setHideFocusRing(on);
            save({ hideFocusRing: on });
          }}
        />
      ) : null}
      {match('AI assistant', query) ? (
        <SettingSwitch
          label="AI assistant"
          description="Show the AI assistant panel and tools."
          checked={aiEnabled}
          onChange={(on) => {
            setAiEnabled(on);
            save({ aiEnabled: on });
          }}
        />
      ) : null}
    </div>
  );
}
