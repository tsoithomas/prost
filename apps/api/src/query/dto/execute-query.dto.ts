import { IsString, MinLength } from 'class-validator';
import type { ExecuteQueryBody } from '@prost/shared-types';

export class ExecuteQueryDto implements ExecuteQueryBody {
  @IsString()
  @MinLength(1)
  sql!: string;
}
