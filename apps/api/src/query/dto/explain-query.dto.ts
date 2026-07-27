import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';
import type { ExplainQueryBody } from '@prost/shared-types';

export class ExplainQueryDto implements ExplainQueryBody {
  @IsString()
  @MinLength(1)
  sql!: string;

  @IsOptional()
  @IsBoolean()
  analyze?: boolean;
}
