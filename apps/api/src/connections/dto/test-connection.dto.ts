import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Max, Min, MinLength } from 'class-validator';
import type { TestConnectionDto as TestConnectionDtoShape, DbEngine } from '@prost/shared-types';

/**
 * Tests either a saved connection (by `id`, falling back to its stored credentials when
 * `password` is blank) or an unsaved set of connection params (all fields required).
 */
export class TestConnectionDto implements TestConnectionDtoShape {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  host?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  database?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  username?: string;

  @IsOptional()
  @IsString()
  password?: string;

  @IsOptional()
  @IsBoolean()
  sslEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  sslRejectUnauthorized?: boolean;

  @IsOptional()
  @IsString()
  engine?: DbEngine;
}
