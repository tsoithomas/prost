import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';
import {
  CONNECTION_ENVIRONMENTS,
  type ConnectionEnvironment,
  type CreateConnectionDto as CreateConnectionDtoShape,
  type DbEngine,
} from '@prost/shared-types';
import { SshFieldsDto } from './ssh-fields.dto';

export class CreateConnectionDto extends SshFieldsDto implements CreateConnectionDtoShape {
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

  @IsIn(CONNECTION_ENVIRONMENTS)
  environment!: ConnectionEnvironment;

  @IsBoolean()
  readOnly!: boolean;

  @IsOptional()
  @IsString()
  engine?: DbEngine;
}
