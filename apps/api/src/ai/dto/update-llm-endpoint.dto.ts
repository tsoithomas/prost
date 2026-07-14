import { ArrayNotEmpty, IsArray, IsInt, IsOptional, IsString, IsUrl, Min, MinLength } from 'class-validator';
import type { UpdateLlmEndpointBody } from '@prost/shared-types';

export class UpdateLlmEndpointDto implements UpdateLlmEndpointBody {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsUrl({ require_tld: false, require_protocol: true })
  baseUrl?: string;

  @IsOptional()
  @IsString()
  apiKey?: string;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  models?: string[];

  @IsOptional()
  @IsInt()
  @Min(500)
  contextBudget?: number | null;

  @IsOptional()
  @IsInt()
  @Min(64)
  maxOutputTokens?: number | null;
}
