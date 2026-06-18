import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsOptional, IsString, MinLength, ValidateNested } from 'class-validator';
import type { CreateTableBody, NewColumn } from '@prost/shared-types';

export class NewColumnDto implements NewColumn {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(1)
  type!: string;

  @IsBoolean()
  nullable!: boolean;

  @IsBoolean()
  isPrimaryKey!: boolean;

  @IsBoolean()
  @IsOptional()
  autoIncrement?: boolean;

  @IsString()
  @IsOptional()
  default?: string;
}

export class CreateTableDto implements CreateTableBody {
  @IsString()
  @MinLength(1)
  schema!: string;

  @IsString()
  @MinLength(1)
  table!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => NewColumnDto)
  columns!: NewColumnDto[];
}
