import { ArrayNotEmpty, IsArray, IsInt, IsOptional, IsString, IsUrl, Min, MinLength } from 'class-validator';
import type { CreateLlmEndpointBody } from '@prost/shared-types';

export class CreateLlmEndpointDto implements CreateLlmEndpointBody {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsUrl({ require_tld: false, require_protocol: true })
  baseUrl!: string;

  @IsString()
  apiKey!: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  models!: string[];

  @IsOptional()
  @IsInt()
  @Min(500)
  contextBudget?: number | null;

  @IsOptional()
  @IsInt()
  @Min(64)
  maxOutputTokens?: number | null;
}
