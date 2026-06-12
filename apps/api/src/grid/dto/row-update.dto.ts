import { IsObject, IsOptional, IsString, MinLength } from 'class-validator';
import type { RowUpdateBody } from '@prost/shared-types';

export class RowUpdateDto implements RowUpdateBody {
  @IsObject()
  primaryKey!: Record<string, unknown>;

  @IsString()
  @MinLength(1)
  column!: string;

  /** Any JSON value (including `null`) — `@IsOptional` only keeps it from being stripped by `whitelist`. */
  @IsOptional()
  value: unknown;
}
