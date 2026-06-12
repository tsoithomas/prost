import { IsIn, IsOptional, IsString, Matches } from 'class-validator';
import type { ColorMode, UserPreferenceDto } from '@prost/shared-types';

const COLOR_MODES: ColorMode[] = ['light', 'dark', 'system'];

export class UpdatePreferenceDto implements Partial<UserPreferenceDto> {
  @IsOptional()
  @IsIn(COLOR_MODES)
  colorMode?: ColorMode;

  @IsOptional()
  @IsString()
  @Matches(/^#[0-9a-fA-F]{6}$/)
  accentColor?: string;
}
