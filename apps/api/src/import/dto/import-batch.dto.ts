import { ArrayMinSize, IsArray, IsString } from 'class-validator';

/**
 * One batch of already-parsed rows to insert. `columns` are target column names; each entry in `rows`
 * is a value array in that same order. Row shape (length matches `columns`, unknown columns) is
 * validated in the service against live metadata.
 */
export class ImportBatchDto {
  @IsString()
  schema!: string;

  @IsString()
  table!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  columns!: string[];

  @IsArray()
  rows!: unknown[][];
}
