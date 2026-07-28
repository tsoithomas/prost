import { IsArray, IsBoolean, IsIn, IsObject, IsOptional, IsString, MinLength } from 'class-validator';
import type { ExportFormat, RowFilter } from '@prost/shared-types';

/**
 * A streamed export request (POST body). `scope` selects a table (schema/table + optional filter), an
 * arbitrary single-SELECT query, or a multi-table SQL dump (`schema`). The service builds bound
 * statements and streams them via the Phase 22 cursor; filter columns are validated in `compileWhere`.
 */
export class ExportDto {
  @IsIn(['table', 'query', 'schema'])
  scope!: 'table' | 'query' | 'schema';

  @IsIn(['csv', 'json', 'sql'])
  format!: ExportFormat;

  @IsOptional()
  @IsString()
  schema?: string;

  @IsOptional()
  @IsString()
  table?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tables?: string[];

  @IsOptional()
  @IsBoolean()
  includeSchema?: boolean;

  @IsOptional()
  @IsBoolean()
  includeData?: boolean;

  @IsOptional()
  @IsObject()
  filter?: RowFilter;

  @IsOptional()
  @IsString()
  @MinLength(1)
  sql?: string;

  @IsOptional()
  @IsString()
  sortBy?: string;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDir?: 'asc' | 'desc';

  @IsOptional()
  @IsString()
  delimiter?: string;

  @IsOptional()
  @IsString()
  nullToken?: string | null;
}
