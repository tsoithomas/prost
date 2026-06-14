import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, MinLength, ValidateIf, ValidateNested } from 'class-validator';
import { NewColumnDto } from './create-table.dto';

const KINDS = ['addColumn', 'dropColumn', 'setNotNull', 'setDefault', 'changeType'] as const;

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
  @ValidateIf((o: AlterTableDto) => o.kind !== 'addColumn')
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
}
