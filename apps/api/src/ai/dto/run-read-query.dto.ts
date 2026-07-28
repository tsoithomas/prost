import { IsString, MinLength } from 'class-validator';

/** Ask the assistant's read-only executor to run a proposed SELECT (Phase 31). */
export class RunReadQueryDto {
  @IsString()
  @MinLength(1)
  sql!: string;
}
