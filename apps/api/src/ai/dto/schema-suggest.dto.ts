import {
  ArrayMaxSize,
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { QueryPlanResult } from '@prost/shared-types';

/** A table to ground the advice in. */
class SuggestTableRefDto {
  @IsString()
  @MinLength(1)
  schema!: string;

  @IsString()
  @MinLength(1)
  table!: string;
}

/**
 * Request AI schema-change suggestions (Phase 33). The plan is accepted as an opaque object and
 * stripped down server-side by `sanitizePlanForPrompt` before it reaches the model — validating its
 * recursive shape here would buy nothing, since nothing is trusted downstream anyway.
 */
export class SchemaSuggestDto {
  @IsUUID()
  endpointId!: string;

  @IsString()
  @MinLength(1)
  model!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(15)
  @ValidateNested({ each: true })
  @Type(() => SuggestTableRefDto)
  tables?: SuggestTableRefDto[];

  @IsOptional()
  @IsObject()
  plan?: QueryPlanResult;

  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  sql?: string;
}
