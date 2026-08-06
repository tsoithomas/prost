import { Type } from 'class-transformer';
import { IsIn, IsString, MinLength, ValidateNested } from 'class-validator';

/** The non-`:id` side of a comparison — a schema on another live connection. */
export class SchemaRefDto {
  @IsString()
  @MinLength(1)
  connectionId!: string;

  @IsString()
  @MinLength(1)
  schema!: string;
}

/** Body for `POST :id/schema-diff/compare` — `schema` is the `:id` connection's schema (the diff's `left`). */
export class SchemaCompareDto {
  @IsString()
  @MinLength(1)
  schema!: string;

  @ValidateNested()
  @Type(() => SchemaRefDto)
  right!: SchemaRefDto;
}

/** Body for `POST :id/schema-diff/migration`. */
export class GenerateMigrationDto extends SchemaCompareDto {
  @IsIn(['left', 'right'])
  source!: 'left' | 'right';
}
