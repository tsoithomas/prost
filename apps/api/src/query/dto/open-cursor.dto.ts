import { IsString, MinLength } from 'class-validator';
import type { OpenCursorBody } from '@prost/shared-types';

export class OpenCursorDto implements OpenCursorBody {
  @IsString()
  @MinLength(1)
  sql!: string;
}
