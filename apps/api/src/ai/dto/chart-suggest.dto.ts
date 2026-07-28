import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsString, IsUUID, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

/** Column metadata as sent by the client for a chart suggestion (mirrors `ColumnMetadata`). */
class ColumnMetadataDto {
  @IsString()
  name!: string;

  @IsString()
  dataType!: string;

  @IsBoolean()
  nullable!: boolean;

  @IsBoolean()
  isPrimaryKey!: boolean;

  @IsBoolean()
  autoIncrement!: boolean;

  @IsOptional()
  @IsString()
  defaultValue!: string | null;
}

/**
 * Request an AI chart suggestion for an already-loaded result page. `sample` is a small, opt-in slice
 * of the page (the service re-caps + sanitizes it defensively); a generous `ArrayMaxSize` here just
 * rejects an abusive payload early.
 */
export class ChartSuggestDto {
  @IsUUID()
  endpointId!: string;

  @IsString()
  @MinLength(1)
  model!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ColumnMetadataDto)
  columns!: ColumnMetadataDto[];

  @IsArray()
  @ArrayMaxSize(200)
  sample!: Record<string, unknown>[];
}
