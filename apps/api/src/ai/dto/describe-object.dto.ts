import { IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

/**
 * Ask the model to draft documentation for one table, or one of its columns (Phase 38). The target is
 * resolved against live metadata by the grounding step, so an unknown name simply yields no context.
 */
export class DescribeObjectDto {
  @IsUUID()
  endpointId!: string;

  @IsString()
  @MinLength(1)
  model!: string;

  @IsString()
  @MinLength(1)
  schema!: string;

  @IsString()
  @MinLength(1)
  table!: string;

  /** Omit to describe the table itself. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  column?: string;
}
