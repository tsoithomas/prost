import { ArrayMinSize, IsArray, IsString } from 'class-validator';

/** Preview an import mapping (no execution): validate target columns against live metadata. */
export class ImportPreviewDto {
  @IsString()
  schema!: string;

  @IsString()
  table!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  columns!: string[];

  @IsArray()
  sampleRows!: unknown[][];
}
