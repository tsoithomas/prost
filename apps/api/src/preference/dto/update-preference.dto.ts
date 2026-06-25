import { IsArray, IsIn, IsObject, IsOptional, IsString, Matches } from 'class-validator';
import {
  FONT_SIZES,
  GRID_DENSITIES,
  type ColorMode,
  type ConnectionThemeOverride,
  type CustomPalette,
  type FontSize,
  type GridDensity,
  type KeybindingMap,
  type UserPreferenceDto,
} from '@prost/shared-types';

const COLOR_MODES: ColorMode[] = ['light', 'dark', 'system'];

// The structured JSON fields (keybindings/customPalettes/connectionOverrides) are deep-validated in
// PreferenceService.update via ./preference-validation — class-validator only shape-gates them here.
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
}
