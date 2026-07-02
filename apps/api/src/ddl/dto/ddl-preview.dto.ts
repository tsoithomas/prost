import { plainToInstance, Transform } from 'class-transformer';
import { IsIn, IsObject, IsString, MinLength, ValidateNested } from 'class-validator';
import { AlterTableDto } from './alter-table.dto';
import { CreateIndexDto } from './create-index.dto';
import { CreateTableDto } from './create-table.dto';
import { DropIndexDto } from './drop-index.dto';

// Preview is offered for the builder-based DDL kinds only; drop/truncate are direct actions.
const KINDS = ['createTable', 'alterTable', 'createIndex', 'dropIndex'] as const;
type PreviewKind = (typeof KINDS)[number];

export class AlterTablePreviewRequestDto extends AlterTableDto {
  @IsString()
  @MinLength(1)
  schema!: string;

  @IsString()
  @MinLength(1)
  table!: string;
}

type PreviewRequestDto = CreateTableDto | AlterTablePreviewRequestDto | CreateIndexDto | DropIndexDto;

function transformRequest(kind: PreviewKind, value: unknown): PreviewRequestDto | unknown {
  switch (kind) {
    case 'createTable':
      return plainToInstance(CreateTableDto, value);
    case 'alterTable':
      return plainToInstance(AlterTablePreviewRequestDto, value);
    case 'createIndex':
      return plainToInstance(CreateIndexDto, value);
    case 'dropIndex':
      return plainToInstance(DropIndexDto, value);
    default:
      return value;
  }
}

export class DdlPreviewDto {
  @IsString()
  @IsIn(KINDS)
  kind!: PreviewKind;

  @IsObject()
  @ValidateNested()
  @Transform(({ obj, value }: { obj: DdlPreviewDto; value: unknown }) => transformRequest(obj.kind, value))
  request!: PreviewRequestDto;
}
