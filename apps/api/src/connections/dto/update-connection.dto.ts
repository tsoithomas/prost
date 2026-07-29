import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';
import {
  CONNECTION_ENVIRONMENTS,
  type ConnectionEnvironment,
  type UpdateConnectionDto as UpdateConnectionDtoShape,
} from '@prost/shared-types';
import { SshFieldsDto } from './ssh-fields.dto';

/** All fields optional; an empty/omitted `password` means "keep the stored credential". */
export class UpdateConnectionDto extends SshFieldsDto implements UpdateConnectionDtoShape {
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

  @IsOptional()
  @IsIn(CONNECTION_ENVIRONMENTS)
  environment?: ConnectionEnvironment;

  @IsOptional()
  @IsBoolean()
  readOnly?: boolean;
}
