import { plainToInstance, Transform } from 'class-transformer';
import { IsIn, IsObject, IsString, MinLength, ValidateNested } from 'class-validator';
import type { DdlPreviewRequest } from '@prost/shared-types';
import { AlterTableDto } from './alter-table.dto';
import { CreateIndexDto } from './create-index.dto';
import { CreateTableDto } from './create-table.dto';
import { DropIndexDto } from './drop-index.dto';

const KINDS = ['createTable', 'alterTable', 'createIndex', 'dropIndex'] as const;

export class AlterTablePreviewRequestDto extends AlterTableDto {
  @IsString()
  @MinLength(1)
  schema!: string;

  @IsString()
  @MinLength(1)
  table!: string;
}

type PreviewRequestDto = CreateTableDto | AlterTablePreviewRequestDto | CreateIndexDto | DropIndexDto;

function transformRequest(kind: DdlPreviewRequest['kind'], value: unknown): PreviewRequestDto | unknown {
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
  kind!: DdlPreviewRequest['kind'];

  @IsObject()
  @ValidateNested()
  @Transform(({ obj, value }: { obj: DdlPreviewDto; value: unknown }) => transformRequest(obj.kind, value))
  request!: PreviewRequestDto;
}
