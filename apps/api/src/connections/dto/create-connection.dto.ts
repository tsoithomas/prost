import { IsBoolean, IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';
import type { CreateConnectionDto as CreateConnectionDtoShape, DbEngine } from '@prost/shared-types';

export class CreateConnectionDto implements CreateConnectionDtoShape {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(1)
  host!: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  port!: number;

  @IsString()
  @MinLength(1)
  database!: string;

  @IsString()
  @MinLength(1)
  username!: string;

  @IsString()
  password!: string;

  @IsBoolean()
  sslEnabled!: boolean;

  @IsBoolean()
  sslRejectUnauthorized!: boolean;

  @IsOptional()
  @IsString()
  engine?: DbEngine;
}
