import { IsBoolean, IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';
import type { UpdateConnectionDto as UpdateConnectionDtoShape } from '@prost/shared-types';

/** All fields optional; an empty/omitted `password` means "keep the stored credential". */
export class UpdateConnectionDto implements UpdateConnectionDtoShape {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

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
}
