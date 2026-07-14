import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsBoolean, IsIn, IsOptional, IsString, MinLength, ValidateIf, ValidateNested } from 'class-validator';
import { FOREIGN_KEY_ACTIONS } from '@prost/shared-types';
import { NewColumnDto } from './create-table.dto';

const KINDS = ['addColumn', 'dropColumn', 'setNotNull', 'setDefault', 'changeType', 'addForeignKey', 'dropForeignKey'] as const;

/** Kinds that address a single column via `columnName`. */
const COLUMN_NAME_KINDS = ['dropColumn', 'setNotNull', 'setDefault', 'changeType'];

export class AlterTableDto {
  @IsString()
  @IsIn(KINDS)
  kind!: string;

  // addColumn
  @ValidateIf((o: AlterTableDto) => o.kind === 'addColumn')
  @ValidateNested()
  @Type(() => NewColumnDto)
  column?: NewColumnDto;

  // dropColumn / setNotNull / setDefault / changeType — target column name
  @ValidateIf((o: AlterTableDto) => COLUMN_NAME_KINDS.includes(o.kind))
  @IsString()
  @MinLength(1)
  columnName?: string;

  // setNotNull
  @ValidateIf((o: AlterTableDto) => o.kind === 'setNotNull')
  @IsBoolean()
  notNull?: boolean;

  // setDefault — null means DROP DEFAULT
  @ValidateIf((o: AlterTableDto) => o.kind === 'setDefault' && (o as AlterTableDto).default !== null)
  @IsOptional()
  @IsString()
  default?: string | null;

  // changeType
  @ValidateIf((o: AlterTableDto) => o.kind === 'changeType')
  @IsString()
  @MinLength(1)
  type?: string;

  @ValidateIf((o: AlterTableDto) => o.kind === 'changeType')
  @IsOptional()
  @IsString()
  using?: string;

  // addForeignKey — local columns (referencing) + referenced target
  @ValidateIf((o: AlterTableDto) => o.kind === 'addForeignKey')
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  columns?: string[];

  @ValidateIf((o: AlterTableDto) => o.kind === 'addForeignKey')
  @IsString()
  @MinLength(1)
  referencedTable?: string;

  @ValidateIf((o: AlterTableDto) => o.kind === 'addForeignKey')
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  referencedColumns?: string[];

  @ValidateIf((o: AlterTableDto) => o.kind === 'addForeignKey' && (o as AlterTableDto).referencedSchema != null)
  @IsOptional()
  @IsString()
  referencedSchema?: string | null;

  @ValidateIf((o: AlterTableDto) => o.kind === 'addForeignKey' && (o as AlterTableDto).onDelete !== undefined)
  @IsIn(FOREIGN_KEY_ACTIONS)
  onDelete?: string;

  @ValidateIf((o: AlterTableDto) => o.kind === 'addForeignKey' && (o as AlterTableDto).onUpdate !== undefined)
  @IsIn(FOREIGN_KEY_ACTIONS)
  onUpdate?: string;

  // addForeignKey (optional) / dropForeignKey (required)
  @ValidateIf((o: AlterTableDto) => o.kind === 'dropForeignKey')
  @IsString()
  @MinLength(1)
  constraintName?: string;
}
