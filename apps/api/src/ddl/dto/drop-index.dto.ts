import { IsString, MinLength } from 'class-validator';
import type { DropIndexRequest } from '@prost/shared-types';

export class DropIndexDto implements DropIndexRequest {
  @IsString()
  @MinLength(1)
  schema!: string;

  @IsString()
  @MinLength(1)
  table!: string;

  @IsString()
  @MinLength(1)
  index!: string;
}
