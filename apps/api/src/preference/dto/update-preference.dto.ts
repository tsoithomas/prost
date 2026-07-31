import { IsArray, IsBoolean, IsIn, IsObject, IsOptional, IsString, Matches } from 'class-validator';
import {
  FONT_FAMILIES,
  FONT_SIZES,
  GRID_DENSITIES,
  MONO_FONT_FAMILIES,
  RADIUS_SCALES,
  type BehaviorPreferences,
  type ColorMode,
  type ColumnRenderOverrides,
  type ConnectionThemeOverride,
  type CustomPalette,
  type DataColorKey,
  type EditorPreferences,
  type FontFamily,
  type FontSize,
  type GridDensity,
  type GridDisplayPreferences,
  type KeybindingMap,
  type MonoFontFamily,
  type RadiusScale,
  type MaskedColumns,
  type UserPreferenceDto,
} from '@prost/shared-types';

const COLOR_MODES: ColorMode[] = ['light', 'dark', 'system'];

// The structured JSON fields (keybindings/customPalettes/connectionOverrides/columnRenderOverrides)
// are deep-validated in PreferenceService.update via ./preference-validation — class-validator only
// shape-gates them here.
export class UpdatePreferenceDto implements Partial<UserPreferenceDto> {
  @IsOptional()
  @IsIn(COLOR_MODES)
  colorMode?: ColorMode;

  @IsOptional()
  @IsString()
  @Matches(/^#[0-9a-fA-F]{6}$/)
  accentColor?: string;

  @IsOptional()
  @IsIn(FONT_SIZES)
  fontSize?: FontSize;

  @IsOptional()
  @IsIn(GRID_DENSITIES)
  gridDensity?: GridDensity;

  @IsOptional()
  @IsObject()
  keybindings?: KeybindingMap;

  @IsOptional()
  @IsArray()
  customPalettes?: CustomPalette[];

  @IsOptional()
  @IsObject()
  connectionOverrides?: Record<string, ConnectionThemeOverride>;

  @IsOptional()
  @IsObject()
  columnRenderOverrides?: ColumnRenderOverrides;

  @IsOptional()
  @IsObject()
  maskedColumns?: MaskedColumns;

  @IsOptional()
  @IsIn(FONT_FAMILIES)
  fontFamily?: FontFamily;

  @IsOptional()
  @IsIn(MONO_FONT_FAMILIES)
  monoFontFamily?: MonoFontFamily;

  @IsOptional()
  @IsIn(RADIUS_SCALES)
  radiusScale?: RadiusScale;

  // Deep-validated (keys + hex) in PreferenceService.update via ./preference-validation.
  @IsOptional()
  @IsObject()
  dataColors?: Partial<Record<DataColorKey, string>>;

  // Nested clusters — deep-validated in PreferenceService.update via ./preference-validation.
  @IsOptional()
  @IsObject()
  editor?: EditorPreferences;

  @IsOptional()
  @IsObject()
  grid?: GridDisplayPreferences;

  @IsOptional()
  @IsObject()
  behavior?: BehaviorPreferences;

  @IsOptional()
  @IsBoolean()
  reduceMotion?: boolean;

  @IsOptional()
  @IsBoolean()
  aiEnabled?: boolean;
}
