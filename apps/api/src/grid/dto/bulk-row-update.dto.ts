import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import type { BulkRowEdit, BulkRowUpdateBody, CellEdit } from '@prost/shared-types';

class CellEditDto implements CellEdit {
  @IsString()
  @MinLength(1)
  column!: string;

  /** Any JSON value (including `null`) — `@IsOptional` only keeps it from being stripped by `whitelist`. */
  @IsOptional()
  value: unknown;
}

class BulkRowEditDto implements BulkRowEdit {
  @IsObject()
  primaryKey!: Record<string, unknown>;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => CellEditDto)
  edits!: CellEditDto[];

  /** token-mode guard: the server-issued `__version` read with the row. */
  @IsOptional()
  @IsString()
  version?: string;

  /** preimage-mode guard: original values of the edited columns. */
  @IsOptional()
  @IsObject()
  expected?: Record<string, unknown>;
}

export class BulkRowUpdateDto implements BulkRowUpdateBody {
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => BulkRowEditDto)
  rows!: BulkRowEditDto[];
}
