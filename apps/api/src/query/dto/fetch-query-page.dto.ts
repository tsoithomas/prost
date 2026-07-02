import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';
import type { FetchQueryPageBody } from '@prost/shared-types';

export class FetchQueryPageDto implements FetchQueryPageBody {
  @IsString()
  @MinLength(1)
  sql!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number;

  @IsOptional()
  @IsString()
  sortBy?: string;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDir?: 'asc' | 'desc';
}
