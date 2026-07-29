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

const fontSizeLabels: Record<FontSize, string> = { sm: 'Small', md: 'Medium', lg: 'Large' };
const fontFamilyLabels: Record<FontFamily, string> = { system: 'System', inter: 'Inter', serif: 'Serif' };
const radiusLabels: Record<RadiusScale, string> = { compact: 'Compact', normal: 'Normal', roomy: 'Roomy' };

export function AppearanceSection({ save, query }: SectionProps) {
  const fontSize = useThemeStore((s) => s.fontSize);
  const fontFamily = useThemeStore((s) => s.fontFamily);
  const radiusScale = useThemeStore((s) => s.radiusScale);
  const reduceMotion = useThemeStore((s) => s.reduceMotion);
  const aiEnabled = useThemeStore((s) => s.aiEnabled);
  const setFontSize = useThemeStore((s) => s.setFontSize);
  const setFontFamily = useThemeStore((s) => s.setFontFamily);
  const setRadiusScale = useThemeStore((s) => s.setRadiusScale);
  const setReduceMotion = useThemeStore((s) => s.setReduceMotion);
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
