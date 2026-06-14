import { IsArray, IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';
import type { CreateIndexRequest } from '@prost/shared-types';

export class CreateIndexDto implements Omit<CreateIndexRequest, 'name' | 'method'> {
  @IsString()
  @MinLength(1)
  schema!: string;

  @IsString()
  @MinLength(1)
  table!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsArray()
  @IsString({ each: true })
  columns!: string[];

  @IsBoolean()
  unique!: boolean;

  @IsOptional()
  @IsString()
  method?: string;
}
